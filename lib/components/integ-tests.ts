import {App, Environment, Stack, StackProps} from "aws-cdk-lib";
import {Vpc} from "aws-cdk-lib/aws-ec2";
import {DataStoresStack} from "./data-stores";
import {CT_WRITE_LAMBDA_NAME} from "../common/compute-constants";
import {ExpectedResult, IntegTest, InvocationType} from "@aws-cdk/integ-tests-alpha";
import {PubSubStack} from "./pub-sub";
import {CtLambdaStack} from "./lambdas";
import {joinStrings} from "../common/utils";
import {Construct} from "constructs";


export interface IntegTestsStackProps {
    readonly app: App;
    readonly env: Environment;
    readonly stage: string;
    readonly suffix: string;
    readonly PubSubStack: PubSubStack;
    readonly DataStoreStack: DataStoresStack;
    readonly CtLambdaStack: CtLambdaStack;
    readonly setupAlarms?: boolean;
}

/*
Refer the documentation for writing various sorts of checks in integ-tests -
1. https://docs.aws.amazon.com/cdk/api/v1/docs/integ-tests-readme.html
2. https://docs.aws.amazon.com/cdk/api/v2/docs/integ-tests-alpha-readme.html
 */
export class IntegTestsStack extends Stack {

    constructor(parent: Construct, name: string, props: IntegTestsStackProps) {
        super(parent, name, <StackProps>{
            ...props
        });

        this.createIntegrationTestingInfra(props);
    }

    private createIntegrationTestingInfra(props: IntegTestsStackProps) {
        const integ = new IntegTest(this, joinStrings('IntegrationTests', props.suffix), {
            testCases: [props.CtLambdaStack, props.PubSubStack],
        });

        integ.assertions.invokeFunction({
            functionName: CT_WRITE_LAMBDA_NAME,
            invocationType: InvocationType.EVENT,
            payload: JSON.stringify({status: 'OK'}),
        });

        console.log("ABCDEFGHIJKL");
        console.log("ABCDEFGHIJKL");
        console.log("ABCDEFGHIJKL");
        console.log("ABCDEFGHIJKL");
        console.log(this.environment);
        console.log("QWERTYQWERTY");
        console.log("QWERTYQWERTY");
        console.log("QWERTYQWERTY");
        console.log("QWERTYQWERTY");
        console.log(props.PubSubStack.environment);
        console.log("!@#$%^&^%$#@!");


        const message = integ.assertions.awsApiCall('SQS', 'receiveMessage', {
            QueueUrl: props.PubSubStack.CtEventsQueue.queueUrl,
            WaitTimeSeconds: 20,
        });

        message.assertAtPath('Messages.0.Body', ExpectedResult.objectLike({
            requestContext: {
                condition: 'Success',
            },
            requestPayload: {
                status: 'OK',
            },
            responseContext: {
                statusCode: 200,
            },
            responsePayload: 'success',
        }));
    }
}
