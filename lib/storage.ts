import { App } from 'aws-cdk-lib';
import {
  DeploymentStack,
  DogmaTagsOptions,
  SoftwareType,
  BrazilPackage,
  ApprovalWorkflowStep,
  DeploymentEnvironment,
  Platform
} from '@amzn/pipelines';
import { IReplicatorFunction, ReplicatedBucket, SourceBucket } from '@amzn/alexa-ml-hosting-constructs';
import { HydraTestRunResources } from '@amzn/hydra';
import {AlexaMLConvention, ApprovalStepConfig} from "@amzn/alexa-ml-common-constructs";

export interface StorageStackProps {
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
   * SourceBucket to copy the objects from.
   */
  readonly sourceBucket: SourceBucket;
  /**
   * Lambda replicator function.
   */
  readonly replicatorFunction: IReplicatorFunction;
  /**
   * Configuration for common approval steps.
   */
  readonly approvalStepConfig?: ApprovalStepConfig;
}

export class StorageStack extends DeploymentStack {
  readonly replicatedBucket: ReplicatedBucket;
  readonly approvalWorkflowSteps: ApprovalWorkflowStep[] = [];

  constructor(parent: App, name: string, props: StorageStackProps) {
    super(parent, name, {
      softwareType: SoftwareType.INFRASTRUCTURE,
      ...props
    });

    const hydraResources = new HydraTestRunResources(this, 'ReplicatorTestResources', {
      hydraEnvironment: props.env.hydraEnvironment,
      hydraAsset: {
        targetPackage: BrazilPackage.fromProps({ name: 'AsmlS3ObjectReplicatorTests', branch: 'mainline' }),
        versionSetPlatform: Platform.AL2_X86_64
      }
    });
    this.replicatedBucket = new ReplicatedBucket(this, 'Replicated', {
      replicatorFunction: props.replicatorFunction,
      sourceBucket: props.sourceBucket,
      bucketName: AlexaMLConvention.generateBucketName('replicated-artifact', props.env),
      replicatorTestProps: {
        name: `${this.stackName}-ReplicatorTest`,
        replicatorTestRoleName: AlexaMLConvention.generateUniqueName('ReplicatorTest', props.env),
        hydraResources: hydraResources
      }
    });
    if (props.approvalStepConfig && props.approvalStepConfig.runIntegrationTests) {
      this.approvalWorkflowSteps.push(this.replicatedBucket.replicatorTestApprovalWorkflowStep);
    }
  }
}
