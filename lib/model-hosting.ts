import {InstanceType, InstanceClass, InstanceSize, ISecurityGroup, SubnetType} from 'aws-cdk-lib/aws-ec2';
import { DeploymentStack, BrazilPackage, SoftwareType, DogmaTagsOptions, ApprovalWorkflowStep, Load, Tps, ApprovalHeuristics, Percentile, Platform, DeploymentEnvironment } from '@amzn/pipelines';
import { HydraTestRunResources } from '@amzn/hydra';
import { App, Stack } from 'aws-cdk-lib';
import { Dashboard, GraphWidget, Alarm, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { ModelData, InvocationHttpResponseCode, Endpoint, IEndpointProductionVariant } from '@amzn/asml-sagemaker';
import { SecureModel, ReplicatedBucket } from '@amzn/alexa-ml-hosting-constructs';
import {
  ApprovalStepConfig, IDeveloperEnvironment,
  AlexaMLS3Location, SecureIsolatedSageMakerVpc,
  BrazilSageMakerContainerImage,
  SyncAlarmsToCarnavalApprovalWorkflowStep, Team, TodWorkerUser
} from '@amzn/alexa-ml-common-constructs';
import { SIMTicketingAlarmAction, TicketSeverity } from "@amzn/alexa-ml-common-constructs";

import { SecureEndpointConfig, StandardEndpointIntegrationTest, StandardEndpointLoadTest } from '@amzn/alexa-ml-hosting-constructs';
import {AlarmNames} from "./monitoring/constants";
import {team} from "./common/constants";


export interface ModelHostingStackProps {
  readonly env: DeploymentEnvironment;
  readonly stackName?: string;
  /**
   * Stack tags that will be applied to all the taggable resources and the stack itself.
   *
   * @default {}
   */
  readonly tags?: {
    [key: string]: string;
  };
  /**
   * Optional Dogma tags. Read `DogmaTags` for mode details or
   * this wiki https://w.amazon.com/bin/view/ReleaseExcellence/Team/Designs/PDGTargetSupport/Tags/
   */
  readonly dogmaTags?: DogmaTagsOptions;
  /**
   * The secure VPC to use for the models.
   */
  readonly secureVpc: SecureIsolatedSageMakerVpc;
  /**
   * The S3 bucket created in the artifact stack. It will be used for both model artifacts and
   * their test data.
   */
  readonly artifactBucket: ReplicatedBucket;

  /**
   * An optional TodWorkerUser.
   */
  readonly todWorkerUser?: TodWorkerUser;
  /**
   * The team who owns these resources.
   */
  readonly team: Team;
  /**
   * Configuration for common approval steps.
   */
  readonly approvalStepConfig?: ApprovalStepConfig;
  /**
   * The developer environment, which will be used to override Hydra settings in a personal account.
   */
  readonly devEnv: IDeveloperEnvironment;
  /**
   * If true, the endpoint will be configured with auto-scaling.
   */
  readonly enableAutoScaling?: boolean;
  /**
  * Enable SIM Ticketing
  * @default true
  */
  readonly enableTicketing?: boolean;

  securityGroups?: ISecurityGroup[];
}

export class ModelHostingStack extends DeploymentStack {
  readonly approvalWorkflowSteps: ApprovalWorkflowStep[] = [];
  readonly modelRoleName: string | undefined;
  readonly modelRoleArn: string;
  readonly alarms: Alarm[]

  constructor(parent: App, name: string, props: ModelHostingStackProps) {
    super(parent, name, {
      softwareType: SoftwareType.INFRASTRUCTURE,
      ...props
    });

    const brazilEcrImage = BrazilSageMakerContainerImage.fromBrazil({
      brazilPackage: BrazilPackage.fromString('GrafSagemakerService'),
      transformPackage: BrazilPackage.fromString('GrafSagemakerService'),
      componentName: 'GrafSagemakerImage',
    });

    const model = new SecureModel(this, 'Model', {
      container: {
        image: brazilEcrImage,
        modelData: ModelData.fromBucket(props.artifactBucket.bucket, 'GrafSagemaker/20220125.tar.gz'),
        environment: {
          AWS_DEFAULT_REGION: this.region,
          AWS_ACCOUNT: this.account
        },
      },
      vpcSubnets: props.secureVpc.vpc.selectSubnets({
        subnetType: SubnetType.ISOLATED
      }),
      vpc: props.secureVpc.vpc,
      cloudWatchEndpoint: props.secureVpc.cloudWatchEndpoint,
      securityGroups: props.securityGroups
    }).model;

    this.modelRoleArn = model.role ? model.role.roleArn : '';
    this.modelRoleName = model.role?.roleName;

    const hydraResources = new HydraTestRunResources(this, 'HydraTestRunResources', {
      hydraEnvironment: props.env.hydraEnvironment,
      hydraAsset: {
        targetPackage: BrazilPackage.fromProps({ name: 'AsmlModelHostingPythonTests', branch: 'mainline' }),
        versionSetPlatform: Platform.AL2_X86_64
      }
    });
    props.devEnv.conditionallyModifyHydraRole(hydraResources.invocationRole);

    const shouldSyncToCarnaval = SyncAlarmsToCarnavalApprovalWorkflowStep.shouldSyncAlarmsToCarnaval(props.approvalStepConfig,
        props.todWorkerUser);

    /**
     * Note that the alarms are defaulted to cutting Ticketing with Sev3 severity. To disable ticketing
     * for a stage-region, you'd need to explicitly set enableTicketing to false in the DeploymentGroup.
     */
    const alarmAction = (props.enableTicketing == false) ? undefined : new SIMTicketingAlarmAction({
      severity: TicketSeverity.SEV3,
      cti: props.team.cti,
      resolverGroup: team.group
    });

    const endpointConfig = new SecureEndpointConfig(this, 'EndpointConfig', {
      productionVariant: {
        model: model,
        variantName: 'main',
        instanceType: InstanceType.of(InstanceClass.C5, InstanceSize.XLARGE)
      },
    }).endpointConfig;

    const endpointName = 'GrafSagemaker';
    const endpoint = new Endpoint(this, 'Endpoint', {
      endpointName: endpointName,
      endpointConfig: endpointConfig,
    });

    const productionVariant = endpoint.findProductionVariant('main');
    if (props.enableAutoScaling) {
      const instanceCount = productionVariant.autoScaleInstanceCount({
        maxCapacity: 10,
      });
      instanceCount.scaleOnInvocations('LimitRPS', {
        maxRequestsPerSecond: 100,
      });
    }

    this.alarms = this.createEndpointAlarms(productionVariant, alarmAction);
    this.createEndpointDashboard(productionVariant);


    if (props.approvalStepConfig && props.approvalStepConfig.runIntegrationTests) {
      this.approvalWorkflowSteps.push(
        new StandardEndpointIntegrationTest({
          name: 'GrafSagemaker endpoint integration test',
          endpoint: endpoint,
          endpointName: endpointName,
          hydraResources: hydraResources,
          testDataLocation: AlexaMLS3Location.fromBucket(
            props.artifactBucket.bucket,
            'test-data/GrafSagemaker/integ/endpoint/20220125',
          ),
          testDataBucketName: props.artifactBucket.bucketName,
          inputFileName: 'input.jsonl',
          outputFileName: 'output.jsonl',
        }).approvalWorkflowStep
      );
    }

    if (StandardEndpointLoadTest.shouldRunLoadTest(props.approvalStepConfig, props.todWorkerUser)) {

      const approvalHeuristics = [
          ApprovalHeuristics.failGlobalErrorRate({ greaterThan: 0.5 }),
          ApprovalHeuristics.failMinuteLatencySLA([StandardEndpointLoadTest.TRANSACTION_NAME, Percentile.P90, 15]),
          ApprovalHeuristics.badDatapointsBeforeFailing(3)];

      if (shouldSyncToCarnaval) {
          //More information on configuring stop alarms here:
          //https://w.amazon.com/index.php/TPSGenerator/Features/EmergencyStop.
          //Severity is stripped from the carnaval alarm name.
          approvalHeuristics.push(
              ApprovalHeuristics.failCarnavalAlarm(name + '-' + this.account + '.' +
                  this.region + '.' + AlarmNames.CPU_UTILIZATION),
              ApprovalHeuristics.failCarnavalAlarm(name + '-' + this.account + '.' +
                  this.region + '.' + AlarmNames.MEMORY_UTILIZATION));

      }
      this.approvalWorkflowSteps.push(
        new StandardEndpointLoadTest({
          name: 'GrafSagemaker endpoint load test',
          endpoint: endpoint,
          todWorkerUser: props.todWorkerUser!,
          testRole: hydraResources.invocationRole,
          testDataLocation: AlexaMLS3Location.fromBucket(
            props.artifactBucket.bucket,
            'test-data/GrafSagemaker/load/endpoint/20220125',
          ),
          inputFileName: 'input.jsonl',
          load: Load.tps(
            [Tps.constant(1), { minutes: 1 }],
            [Tps.constant(10), { minutes: 1 }],
            [Tps.constant(50), { minutes: 15 }],
          ),
          approvalHeuristic: ApprovalHeuristics.any(approvalHeuristics),
          versionSetPlatform: Platform.AL2_X86_64,
        }).approvalWorkflowStep
      );
    }

    if (shouldSyncToCarnaval) {
      this.approvalWorkflowSteps.push(
        new SyncAlarmsToCarnavalApprovalWorkflowStep(Stack.of(this), {
          team: props.team,
          todWorkerUser: props.todWorkerUser!,
        })
      );
    }
  }

  private createEndpointAlarms(productionVariant: IEndpointProductionVariant, alarmAction?: SIMTicketingAlarmAction) {
    let alarms : Alarm[] = [];
    alarms.push(productionVariant.metricModelLatency({ statistic: 'p90' }).createAlarm(this, AlarmNames.MODEL_LATENCY, {
      alarmName: AlarmNames.MODEL_LATENCY + 'SEV3',
      threshold: 100000,
      evaluationPeriods: 3,
      treatMissingData: TreatMissingData.NOT_BREACHING
    }));

    alarms.push(productionVariant.metricCPUUtilization().createAlarm(this, AlarmNames.CPU_UTILIZATION, {
      alarmName: AlarmNames.CPU_UTILIZATION + 'SEV3',
      /**
      * Use the number of CPUs available for your chosen instance type multiplied by the max % CPU usage per CPU.
      * Example: If you want to set an alarm for 80% CPU and you are working with M5 Large, you have to set
      * threshold = 2(CPUs) x 80(% CPU per CPU) = 160
      * See here: https://docs.aws.amazon.com/sagemaker/latest/dg/monitoring-cloudwatch.html for more information
       * and here: https://aws.amazon.com/ec2/instance-types/ for instance CPU configuration.
       */
      threshold: 160,
      evaluationPeriods: 3,
    }));

    alarms.push(productionVariant.metricDiskUtilization().createAlarm(this, AlarmNames.DISK_UTILIZATION, {
      alarmName: AlarmNames.DISK_UTILIZATION + 'SEV3',
      threshold: 80,
      evaluationPeriods: 3,
    }));

    alarms.push(productionVariant.metricMemoryUtilization().createAlarm(this, AlarmNames.MEMORY_UTILIZATION, {
      alarmName: AlarmNames.MEMORY_UTILIZATION + 'SEV3',
      threshold: 80,
      evaluationPeriods: 3,
    }));

    alarms.push(productionVariant.metricInvocationResponseCode(InvocationHttpResponseCode.INVOCATION_4XX_ERRORS).createAlarm(this, AlarmNames.INVOCATION_4XX_ERRORS, {
      alarmName: AlarmNames.INVOCATION_4XX_ERRORS + 'SEV3',
      threshold: 10,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING
    }));

    alarms.push(productionVariant.metricInvocationResponseCode(InvocationHttpResponseCode.INVOCATION_5XX_ERRORS).createAlarm(this, AlarmNames.INVOCATION_5XX_ERRORS, {
      alarmName: AlarmNames.INVOCATION_5XX_ERRORS + 'SEV3',
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING
    }));
    if (alarmAction) {
      alarms.forEach( alarm => alarm.addAlarmAction(alarmAction));
    }
    return alarms;
  }

  private createEndpointDashboard(productionVariant: IEndpointProductionVariant) {
    const dashboard = new Dashboard(this, `GrafSagemakerEndpointDashboard-${this.region}`);
    dashboard.addWidgets(
      new GraphWidget({ title: 'CPU Utilization', left: [productionVariant.metricCPUUtilization()] }),
      new GraphWidget({ title: 'Memory Utilization', left: [productionVariant.metricMemoryUtilization()] }),
      new GraphWidget({ title: 'Disk Utilization', left: [productionVariant.metricDiskUtilization()] }),
    );
    dashboard.addWidgets(
      new GraphWidget({ title: 'Invocations', left: [productionVariant.metricInvocations()] }),
      new GraphWidget({ title: 'Invocations Per Instance', left: [productionVariant.metricInvocationsPerInstance()] }),
      new GraphWidget({
        title: 'Invocation Errors', left: [
          productionVariant.metricInvocationResponseCode(InvocationHttpResponseCode.INVOCATION_4XX_ERRORS),
          productionVariant.metricInvocationResponseCode(InvocationHttpResponseCode.INVOCATION_5XX_ERRORS),
        ]
      }),
    );
    dashboard.addWidgets(
      new GraphWidget({ title: 'Model Latency P50', left: [productionVariant.metricModelLatency({ statistic: 'p50' })] }),
      new GraphWidget({ title: 'Model Latency P90', left: [productionVariant.metricModelLatency({ statistic: 'p90' })] }),
      new GraphWidget({ title: 'Model Latency P99', left: [productionVariant.metricModelLatency({ statistic: 'p99' })] }),
    );
    dashboard.addWidgets(
      new GraphWidget({ title: 'Overhead Latency P50', left: [productionVariant.metricOverheadLatency({ statistic: 'p50' })] }),
      new GraphWidget({ title: 'Overhead Latency P90', left: [productionVariant.metricOverheadLatency({ statistic: 'p90' })] }),
      new GraphWidget({ title: 'Overhead Latency P99', left: [productionVariant.metricOverheadLatency({ statistic: 'p99' })] }),
    );
  }

}
