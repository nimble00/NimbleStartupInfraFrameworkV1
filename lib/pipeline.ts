import {Construct, DependencyGroup} from 'constructs';
import {CodePipeline, CodePipelineSource, ShellStep} from 'aws-cdk-lib/pipelines';
import {App, Stack, StackProps, Stage} from "aws-cdk-lib";
import {STAGES_CONFIG} from "./common/app-constants";
import {VpcStack} from "./components/vpc";
import {CfnDeploymentGroup} from "aws-cdk-lib/aws-codedeploy";
import {joinStrings} from "./common/utils";

export interface MyPipelineStackProps extends StackProps {
    readonly app: App;
}

export class MyPipelineStack extends Stack {

    constructor(scope: Construct, id: string, props: MyPipelineStackProps) {
        super(scope, id, props);

        const pipeline = new CodePipeline(this, 'MyPipeline', {
            pipelineName: 'MyPipeline',
            synth: new ShellStep('Synth', {
                input: CodePipelineSource.gitHub('OWNER/REPO', 'main'),
                commands: ['npm ci', 'npm run build', 'npx cdk synth']
            })
        });

        for (let stageConfig of STAGES_CONFIG) {
            const environment = { account: stageConfig.accountId, region: stageConfig.region };
            const resourceIdSuffix = joinStrings(stageConfig.name, stageConfig.region);

            const stage = pipeline.addStage(new Stage(this, stageConfig.name, {
                env: environment
            }));

            const vpcStack = new VpcStack(props.app, `Vpc-${resourceIdSuffix}`, {
                app: props.app,
                env: environment,
                suffix: resourceIdSuffix
            });
        }
    }
}