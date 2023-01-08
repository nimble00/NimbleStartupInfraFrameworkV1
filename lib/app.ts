#!/usr/bin/env node
import 'source-map-support/register';
import {App} from 'aws-cdk-lib';
import {
  BrazilPackage,
  CodeReviewVerificationApprovalWorkflowStep,
  DeploymentPipeline,
  Platform,
  ScanProfile,
  GordianKnotScannerApprovalWorkflowStep
} from '@amzn/pipelines';
import {VpcStack} from '../lib/vpc';
import {ModelHostingStack} from '../lib/model-hosting';
import {SourceStorageStack} from '../lib/source-storage';
import {ModelHostingLambdas, ReplicationTargets} from '@amzn/alexa-ml-hosting-constructs';
import {StorageStack} from '../lib/storage';
import {
  AlexaMLConvention,
  DeveloperEnvironment
} from '@amzn/alexa-ml-common-constructs';
import {DataStoresStack} from '../lib/components/data-stores';
import {IngestOrderStack} from "./components/ingest-infer-orders";
import {applicationName, STAGE, STAGES_CONFIG, team} from "./common/constants";
import {IngestInferLambdaStack} from "./components/ingest-infer-lambda";
import {MonitorDashboardStack} from "./monitoring/dashboard-alarming";
import {HYDRA_RUN_DEFINITION} from "./common/hydra";

const app = new App();

const devEnv = DeveloperEnvironment.fromEnvironmentVariables(process.env);

const pipelineConfiguration = devEnv.conditionallyOverridePipelineConfiguration({
  accountId: '263725116759',
  emailList: `${team.alias}@amazon.com`,
  pipelineId: '4057822',
  pipelineName: applicationName,
  sourceDeploymentGroup: {
    accountId: '263725116759',
    region: 'eu-west-1'
  },
  stages: [
      STAGES_CONFIG[STAGE.DEVO],
      STAGES_CONFIG[STAGE.PROD]
  ],
  trackingVersionSetName: 'live',
  versionSetName: `${applicationName}/development`
});

const pipeline = new DeploymentPipeline(app, 'pipeline', {
  account: pipelineConfiguration.accountId,
  pipelineName: pipelineConfiguration.pipelineName, // Choose wisely this can not be changed after the pipeline is created
  pipelineId: pipelineConfiguration.pipelineId,
  versionSet: pipelineConfiguration.versionSetName,
  trackingVersionSet: pipelineConfiguration.trackingVersionSetName,
  versionSetPlatform: Platform.AL2_X86_64,
  targetPackage: BrazilPackage.fromProps({ name: 'GrafSagemakerCDK', branch: 'mainline', majorVersion: '1.0' }),
  bindleGuid: 'amzn1.bindle.resource.76vch5x2mx7gixd6jnwa',
  packages: [
      BrazilPackage.fromProps({ name: 'GrafSagemakerService', branch: 'mainline' }),
      BrazilPackage.fromProps({ name: 'GrafRealtimeExperiments', branch: 'mainline' }),
      BrazilPackage.fromProps({ name: 'GrafRealtimeIntegrationTests', branch: 'mainline' })
  ],
  manualApproval: false
});

if (pipelineConfiguration.publishToLivePackages) {
  pipelineConfiguration.publishToLivePackages.forEach(brazilPackage => pipeline.addPackageToAutopublish(brazilPackage, 'live'));
}

const versionSetStage = pipeline.versionSetStage;
versionSetStage.addApprovalWorkflow('Version Set Approval Workflow')
  .addStep(new CodeReviewVerificationApprovalWorkflowStep())
  .addStep(new GordianKnotScannerApprovalWorkflowStep({
    name: 'Gordian Knot',
    scanProfileName: ScanProfile.ASSERT_HIGH,
    platform: Platform.AL2_X86_64,
  }));

// Add source stage
const sourceStageName = `Source`;
const sourceDeploymentGroup = pipelineConfiguration.sourceDeploymentGroup!;
const deploymentGroupSuffix = `${sourceStageName}-${sourceDeploymentGroup.region}`;
const sourceModelArtifactStack = new SourceStorageStack(app, `SourceModelArtifact-${deploymentGroupSuffix}`, {
  env: pipeline.deploymentEnvironmentFor(sourceDeploymentGroup.accountId, sourceDeploymentGroup.region),
  replicationTargets: ReplicationTargets.fromPipelineConfiguration(pipelineConfiguration)
});
const sourceDeploymentStage = pipeline.addStage(sourceStageName, {
  isProd: false
});
sourceDeploymentStage.addDeploymentGroup({
  name: `Application-${deploymentGroupSuffix}`,
  stacks: [sourceModelArtifactStack]
});

// Add all stages
const modelHostingLambdas = new ModelHostingLambdas();
for (let stageConfig of pipelineConfiguration.stages) {
  const stage = pipeline.addStage(AlexaMLConvention.generateStageName(stageConfig), {
    isProd: stageConfig.prod ? stageConfig.prod : false,
  });

  // Add each deployment group
  for (let deploymentGroup of stageConfig.deploymentGroups) {
    const region = deploymentGroup.region;
    const environment = pipeline.deploymentEnvironmentFor(deploymentGroup.accountId, region);
    const deploymentGroupSuffix = `${stageConfig.name}-${region}`;
    const deploymentGroupTarget = stage.addDeploymentGroup({
      name: `Application-${deploymentGroupSuffix}`
    });

    const vpcStack = new VpcStack(app, `Vpc-${deploymentGroupSuffix}`, {
      env: environment,
      stage: deploymentGroupSuffix,
      todWorker: deploymentGroup.todWorker
    });

    const modelArtifactStack = new StorageStack(app, `ModelArtifact-${deploymentGroupSuffix}`, {
      env: environment,
      sourceBucket: sourceModelArtifactStack.sourceBucket,
      replicatorFunction: modelHostingLambdas.replicatorFunction,
      approvalStepConfig: deploymentGroup.approvalStepConfig,
    });

    const dataStoreStack = new DataStoresStack(app, `DataStores-${deploymentGroupSuffix}`,{
      env: environment,
      vpcStack: vpcStack,
      suffix: deploymentGroupSuffix,
      stage: stageConfig.name
    });
    dataStoreStack.addDependency(vpcStack);

    const modelHostingStack = new ModelHostingStack(app, `Model-${deploymentGroupSuffix}`, {
      env: environment,
      secureVpc: vpcStack.secureVpc,
      todWorkerUser: vpcStack.todWorkerUser,
      artifactBucket: modelArtifactStack.replicatedBucket,
      team: team,
      approvalStepConfig: deploymentGroup.approvalStepConfig,
      devEnv: devEnv,
      enableAutoScaling: true,
      enableTicketing: deploymentGroup.enableTicketing,
      securityGroups: [vpcStack.modelSecurityGroup]
    });
    modelHostingStack.addDependency(vpcStack);

    const ingestInferObserverStack = new IngestOrderStack(app, `IngestOrders-${deploymentGroupSuffix}`, {
      env: environment,
      vpcStack: vpcStack,
      stage: stageConfig.name,
      modelRoleName: modelHostingStack.modelRoleName,
      queuesConfig: STAGES_CONFIG[stageConfig.name].queuesConfig,
      setupAlarms: STAGES_CONFIG[stageConfig.name].setupAlarms
    });
    ingestInferObserverStack.addDependency(modelHostingStack);

    const ingestInferLambdaStack = new IngestInferLambdaStack(app, `IngestInferLambda-${deploymentGroupSuffix}`, {
      env: environment,
      secureVpc: vpcStack.secureVpc.vpc,
      stage: stageConfig.name,
      dgSuffix: deploymentGroupSuffix,
      IngestInferObserverStack: ingestInferObserverStack,
      DataStoreStack: dataStoreStack,
      lambdasConfig: STAGES_CONFIG[stageConfig.name].lambdasConfig,
      setupAlarms: STAGES_CONFIG[stageConfig.name].setupAlarms
    });
    ingestInferLambdaStack.addDependency(ingestInferObserverStack);
    ingestInferLambdaStack.addDependency(dataStoreStack);

    const monitorDashboardStack = new MonitorDashboardStack(app, `CodebaseMetricsDashboard-${deploymentGroupSuffix}`, {
      env: environment,
      stage: stageConfig.name,
      allAlarms: [
          ...modelHostingStack.alarms,
          ...ingestInferObserverStack.alarms,
          ...ingestInferLambdaStack.alarms
      ]
    });

    deploymentGroupTarget.addStacks(vpcStack, modelArtifactStack, dataStoreStack, ingestInferObserverStack, ingestInferLambdaStack, monitorDashboardStack);
    
    if(deploymentGroup.deployModelHostingStack === undefined || deploymentGroup.deployModelHostingStack) {
      deploymentGroupTarget.addStacks(modelHostingStack);
    }

    if (deploymentGroup.approvalStepConfig?.runIntegrationTests) {
      let runDefinition = HYDRA_RUN_DEFINITION;
      runDefinition['EnvironmentVariables']['AccountId'] = deploymentGroup.accountId;
      runDefinition['EnvironmentVariables']['Stage'] = stage.name;
      runDefinition['EnvironmentVariables']['Region'] = deploymentGroup.region;
      const hydraApproval = ingestInferLambdaStack.hydraResources.createApprovalWorkflowStep({
        runDefinition,
        name: `Hydra Tests-${deploymentGroupSuffix}`,
        versionSetPlatform: Platform.AL2_X86_64
      });
      stage.addApprovalWorkflow(`Integ Test-${deploymentGroupSuffix}`, {
        sequence: [hydraApproval]
      });
    }
  }
}
