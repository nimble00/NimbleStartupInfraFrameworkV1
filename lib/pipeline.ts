import {Construct} from 'constructs';
import {CodePipeline, CodePipelineSource, ShellStep} from 'aws-cdk-lib/pipelines';
import {App, Stack, StackProps} from "aws-cdk-lib";
import {STAGES_CONFIG} from "./common/app-constants";
import {joinStrings} from "./common/utils";
import {MyPipelineAppStage} from "./pipeline-stage";
import {CodeStarConnectionsSourceAction} from "aws-cdk-lib/aws-codepipeline-actions";
import {Artifact} from "aws-cdk-lib/aws-codepipeline";
import {Connections} from "aws-cdk-lib/aws-ec2";

export interface MyPipelineStackProps extends StackProps {
    readonly app: App;
}

export class MyPipelineStack extends Stack {

    constructor(scope: Construct, id: string, props: MyPipelineStackProps) {
        super(scope, id, props);

        const pipeline = new CodePipeline(this, 'MyPipeline', {
            pipelineName: 'MyPipeline',
            synth: new ShellStep('Synth', {
                // input: CodePipelineSource.gitHub('nimble00/NimbleStartupInfraFrameworkV1', 'main'),
                input: CodePipelineSource.connection('nimble00/NimbleStartupInfraFrameworkV1', 'main', {
                    connectionArn: "arn:aws:codestar-connections:eu-west-1:426504476514:connection/a95ae479-80e3-40f4-943e-9285dc15be5d", // it was created manually via aws console
                }),
                commands: ['npm ci', 'npm run build', 'npx cdk synth']

            })
        });

        for (let stageConfig of STAGES_CONFIG) {
            const environment = {account: stageConfig.accountId, region: stageConfig.region};
            const resourceIdSuffix = joinStrings(stageConfig.name, stageConfig.region);

            pipeline.addStage(new MyPipelineAppStage(this, `MyPipelineAppStage-${resourceIdSuffix}`, {
                app: props.app,
                env: environment,
                stageConfig: stageConfig,
                suffix: resourceIdSuffix
            }));

        }
    }
}