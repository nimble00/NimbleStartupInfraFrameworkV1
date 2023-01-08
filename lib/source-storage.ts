import { App } from 'aws-cdk-lib';
import { DeploymentStack, SoftwareType, DogmaTagsOptions, DeploymentEnvironment } from '@amzn/pipelines';
import { SourceBucket, IReplicationTargets } from '@amzn/alexa-ml-hosting-constructs';
import {AlexaMLConvention} from "@amzn/alexa-ml-common-constructs";

export interface SourceStorageStackProps {
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
   * Target accounts to replicate model artifacts to.
   */
  readonly replicationTargets: IReplicationTargets;
}

export class SourceStorageStack extends DeploymentStack {
  readonly sourceBucket: SourceBucket;

  constructor(parent: App, name: string, props: SourceStorageStackProps) {
    super(parent, name, {
      softwareType: SoftwareType.INFRASTRUCTURE,
      ...props
    });
    this.sourceBucket = new SourceBucket(this, 'Source', {
      replicationTargets: props.replicationTargets,
      bucketName: AlexaMLConvention.generateBucketName('source-artifact', props.env),
      replicatorTestRoleName: AlexaMLConvention.generateUniqueName('SourceReplicatorTest', props.env)
    });
  }
}