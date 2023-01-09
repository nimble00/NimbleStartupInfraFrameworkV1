import {App, Duration, Environment, Stack, StackProps} from "aws-cdk-lib";
import {Queue} from "aws-cdk-lib/aws-sqs";
import {Vpc} from "aws-cdk-lib/aws-ec2";
import {
    Effect,
    ManagedPolicy,
    PolicyDocument,
    PolicyStatement,
    Role,
    ServicePrincipal
} from "aws-cdk-lib/aws-iam";
import {Code, DockerImageFunction, EventSourceMapping, Function, Runtime} from "aws-cdk-lib/aws-lambda";
import {Alarm, AlarmWidget, Dashboard, GraphWidget, TreatMissingData} from "aws-cdk-lib/aws-cloudwatch";
import {DataStoresStack} from "./data-stores";;
import {CT_WRITE_LAMBDA_NAME} from "../common/compute-constants";
import * as path from "path";
import {ExpectedResult, IntegTest, InvocationType} from "@aws-cdk/integ-tests-alpha";
import {CLICK_THRU_EVENTS_Q_NAME} from "../common/pubsub-constants";
import {PubSubStack} from "./pub-sub";
import {AlarmNames, SERVICE_RUNBOOK_LINK, STATISTIC} from "../monitoring/telemetry-constants";


export interface CtLambdaStackProps {
    readonly app: App;
    readonly env: Environment;
    readonly stage: string;
    readonly secureVpc: Vpc;
    readonly suffix: string;
    readonly PubSubStack: PubSubStack;
    readonly DataStoreStack: DataStoresStack;
    readonly lambdasConfig: any;
    readonly setupAlarms: boolean;
}


export class CtLambdaStack extends Stack {

    CtEventsLambda: Function;
    CtLambdaBasicIamRole: Role;
    alarms: Alarm[] = [];

    constructor(parent: App, name: string, props: CtLambdaStackProps) {
        super(parent, name, <StackProps>{
            ...props
        });

        this.createLambdaIamRole(this, props);
        this.createCtLambdaAndMapping(this, props);

        this.createIntegrationTestingInfra(this, props);

        this.createLambdaDashboard('CtEventsLambda', this.CtEventsLambda, props.PubSubStack.CtEventsQueue, props.PubSubStack.CtEventsDLQ, props.stage);
        if (props.setupAlarms) {
            this.createLambdaAlarms('CtEventsLambda', this.CtEventsLambda, props.stage);
        }
    }

    private createLambdaIamRole(scope: Stack, props: CtLambdaStackProps) {

        this.CtLambdaBasicIamRole = new Role(scope, `CtLambdaBasicIamRole-${props.suffix}`, {
            assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
                ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaVPCAccessExecutionRole"),
            ],
            inlinePolicies: {
                'LambdaDDBAccessInlineCustomPolicy': new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ["dynamodb:BatchGet*", "dynamodb:GetItem", "dynamodb:PutItem"],
                            resources: [props.DataStoreStack.ddbTable.tableArn]
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ["sqs:ReceiveMessage", "sqs:GetQueueAttributes", "sqs:SendMessage", "sqs:DeleteMessage"],
                            resources: [
                                props.PubSubStack.CtEventsQueue.queueArn, props.PubSubStack.CtEventsDLQ.queueArn
                            ]
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ["cloudwatch:PutMetricData"],
                            resources: ["*"]
                        })
                    ]
                })
            }
        });
    }

    private createCtLambdaAndMapping(scope: Stack, props: CtLambdaStackProps) {
        this.CtEventsLambda = new DockerImageFunction(scope, CT_WRITE_LAMBDA_NAME, {
            functionName: CT_WRITE_LAMBDA_NAME,
            description: '<<<insert description here>>>',
            environment: {
                DDBTableArn: props.DataStoreStack.ddbTable.tableArn,
                AWS_SERVICE_REGION: String(props.env.region)
            },
            handler: 'index.main',
            code: Code.fromAsset(path.join(__dirname, '/../src/my-lambda')),
            memorySize: 1024,
            vpc: props.secureVpc,
            runtime: Runtime.FROM_IMAGE,
            deadLetterQueueEnabled: true,
            role: this.CtLambdaBasicIamRole,
            reservedConcurrentExecutions: 1,
            timeout: Duration.minutes(15),
        })

        new EventSourceMapping(scope, "CtEventSQSEventSourceMapping", {
            eventSourceArn: props.PubSubStack.CtEventsQueue.queueArn,
            target: this.CtEventsLambda,
            enabled: true,
            batchSize: props.lambdasConfig[CT_WRITE_LAMBDA_NAME].batchSize,
            maxBatchingWindow: props.lambdasConfig[CT_WRITE_LAMBDA_NAME].maxBatchingWindow,
            reportBatchItemFailures: true
        });

    }

    private createIntegrationTestingInfra(scope: Stack, props: CtLambdaStackProps) {
        const integ = new IntegTest(app, 'Integ', {
            testCases: [stack],
        });

        integ.assertions.invokeFunction({
            functionName: CT_WRITE_LAMBDA_NAME,
            invocationType: InvocationType.EVENT,
            payload: JSON.stringify({ status: 'OK' }),
        });

        const message = integ.assertions.awsApiCall('SQS', 'receiveMessage', {
            QueueUrl: CLICK_THRU_EVENTS_Q_NAME.queueUrl,
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
        this.CtEventsLambda.grantInvoke(this.hydraResources.invocationRole);
    }

    private createLambdaDashboard(fname: string, productionVariant: Function, mainQ: Queue, dlQ: Queue, stage: string) {
        const dashboard = new Dashboard(this, `${fname}-Dashboard-${stage}-${this.region}`);
        dashboard.addWidgets(
            new AlarmWidget({
                alarm: productionVariant.metricErrors({statistic: STATISTIC.SUM}).createAlarm(this,
                    `${fname}-${AlarmNames.LAMBDA_INVOCATION_ERRORS2}`, {
                        alarmName: `${fname}-LAMBDA_INVOCATION_ERRORS_SEV2`,
                        alarmDescription: `CT Lambda:${AlarmNames.LAMBDA_INVOCATION_ERRORS2} breached the threshold (${50}). \n
                Refer the Service Runbook - ${SERVICE_RUNBOOK_LINK}`,
                        threshold: 50,
                        evaluationPeriods: 5,
                        treatMissingData: TreatMissingData.NOT_BREACHING
                    })
            }),
            new GraphWidget({title: 'Lambda Duration', left: [productionVariant.metricDuration()]}),
            new GraphWidget({title: 'Lambda Throttles', left: [productionVariant.metricThrottles()]}),
        );
        dashboard.addWidgets(
            new GraphWidget({title: 'Invocations', left: [productionVariant.metricInvocations()]}),
            new GraphWidget({
                title: `${mainQ.queueName} ApproximateAgeOfOldestMessage`,
                left: [mainQ.metricApproximateAgeOfOldestMessage({statistic: STATISTIC.MAX})]
            }),
            new GraphWidget({
                title: `${dlQ.queueName} ApproximateAgeOfOldestMessage`,
                left: [dlQ.metricApproximateAgeOfOldestMessage({statistic: STATISTIC.MAX})]
            }),
        );
        dashboard.addWidgets(
            new GraphWidget({
                title: `${mainQ.queueName} ApproximateNumberOfMessagesNotVisible`,
                left: [mainQ.metricApproximateNumberOfMessagesNotVisible({statistic: STATISTIC.MAX})],
                right: [mainQ.metricApproximateNumberOfMessagesNotVisible({statistic: STATISTIC.SUM})]
            }),
            new GraphWidget({
                title: `${mainQ.queueName} ApproximateNumberOfMessagesVisible`,
                left: [mainQ.metricApproximateNumberOfMessagesVisible({statistic: STATISTIC.MAX})],
                right: [mainQ.metricApproximateNumberOfMessagesVisible({statistic: STATISTIC.SUM})]
            }),
            new GraphWidget({
                title: `${mainQ.queueName} SentMessageSize`,
                left: [mainQ.metricSentMessageSize({statistic: STATISTIC.MAX})]
            }),
        );
        dashboard.addWidgets(
            new GraphWidget({
                title: `${mainQ.queueName} NumberOfEmptyReceives`,
                left: [mainQ.metricNumberOfEmptyReceives({statistic: STATISTIC.SUM})]
            }),
            new GraphWidget({
                title: `${mainQ.queueName} NumberOfMessagesDeleted`,
                left: [mainQ.metricNumberOfMessagesDeleted({statistic: STATISTIC.SUM})]
            }),
            new GraphWidget({
                title: `${mainQ.queueName} NumberOfMessagesReceived`,
                left: [mainQ.metricNumberOfMessagesReceived({statistic: STATISTIC.SUM})]
            }),
            new GraphWidget({
                title: `${mainQ.queueName} NumberOfMessagesSent`,
                left: [mainQ.metricNumberOfMessagesSent({statistic: STATISTIC.SUM})]
            }),
        );
    }

    private createLambdaAlarms(fname: string, productionVariant: Function, stage: string) {
        let alarmsSev2_5: Alarm[] = [];

        alarmsSev2_5.push(productionVariant.metricErrors({statistic: STATISTIC.SUM}).createAlarm(this,
            `${fname}-${AlarmNames.LAMBDA_INVOCATION_ERRORS2}`, {
                alarmName: `${fname}-LAMBDA_INVOCATION_ERRORS_SEV2`,
                alarmDescription: `CT Lambda:${AlarmNames.LAMBDA_INVOCATION_ERRORS2} breached the threshold (${50}). \n
                Refer the Service Runbook - ${SERVICE_RUNBOOK_LINK}`,
                threshold: 50,
                evaluationPeriods: 5,
                treatMissingData: TreatMissingData.NOT_BREACHING
            })
        );

        this.alarms.push(...alarmsSev2_5);
    }

}