import {Construct} from "constructs";
import {VpcStack} from "./components/vpc";
import {DataStoresStack} from "./components/data-stores";
import {PubSubStack} from "./components/pub-sub";
import {CtLambdaStack} from "./components/lambdas";
import {IntegTestsStack} from "./components/integ-tests";
import {App, Environment, Stage, StageProps} from "aws-cdk-lib";

export interface MyPipelineAppStageProps extends StageProps {
    app: App;
    env: Environment;
    suffix: string;
    stageConfig: any;
}

export class MyPipelineAppStage extends Stage {

    constructor(scope: Construct, id: string, props: MyPipelineAppStageProps) {
        super(scope, id, props);

        const vpcStack = new VpcStack(props.app, `Vpc-${props.suffix}`, {
            app: props.app,
            env: props.env,
            suffix: props.suffix
        });

        const dataStoreStack = new DataStoresStack(props.app, `DataStore-${props.suffix}`, {
            env: props.env,
            suffix: props.suffix,
            vpcStack: vpcStack
        });

        const pubSubStack = new PubSubStack(props.app, `PubSub-${props.suffix}`, {
            app: props.app,
            env: props.env,
            queuesConfig: props.stageConfig.queuesConfig,
            setupAlarms: props.stageConfig.setupAlarms,
            stage: props.stageConfig.name,
            suffix: props.suffix,
            vpcStack: vpcStack
        });

        const ctLambdaStack = new CtLambdaStack(props.app, `Lambdas-${props.suffix}`, {
            DataStoreStack: dataStoreStack,
            PubSubStack: pubSubStack,
            app: props.app,
            env: props.env,
            lambdasConfig: props.stageConfig.lambdasConfig,
            secureVpc: vpcStack.secureVpc,
            setupAlarms: props.stageConfig.setupAlarms,
            stage: props.stageConfig.name,
            suffix: props.suffix
        });

        const integTestsStack = new IntegTestsStack(props.app, `IntegTests-${props.suffix}`, {
            CtLambdaStack: ctLambdaStack,
            DataStoreStack: dataStoreStack,
            PubSubStack: pubSubStack,
            app: props.app,
            env: props.env,
            stage: props.stageConfig.name,
            suffix: props.suffix
        })
    }
}