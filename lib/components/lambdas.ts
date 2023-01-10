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
import {Code, EventSourceMapping, Function, Runtime} from "aws-cdk-lib/aws-lambda";
import {Alarm, AlarmWidget, Dashboard, GraphWidget, TreatMissingData} from "aws-cdk-lib/aws-cloudwatch";
import {DataStoresStack} from "./data-stores";
import {CT_WRITE_LAMBDA_INVOKE_ERRORS_THRESHOLD, CT_WRITE_LAMBDA_NAME} from "../common/compute-constants";
import * as path from "path";
import {PubSubStack} from "./pub-sub";
import {AlarmNames, SERVICE_RUNBOOK_LINK, STATISTIC} from "../monitoring/telemetry-constants";
import {Construct} from "constructs";


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

    constructor(parent: Construct, name: string, props: CtLambdaStackProps) {
        super(parent, name, <StackProps>{
            ...props
        });

        this.createLambdaIamRole(this, props);
        this.createCtLambdaAndMapping(this, props);

        this.createLambdaDashboard('CtEventsLambda', this.CtEventsLambda, props.PubSubStack.CtEventsQueue, props.PubSubStack.CtEventsDLQ, props.stage);
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
        // lambda function definition
        this.CtEventsLambda = new Function(this, CT_WRITE_LAMBDA_NAME, {
            functionName: CT_WRITE_LAMBDA_NAME, // cannot be modified easily so decide carefully
            description: 'description',
            runtime: Runtime.PYTHON_3_8,
            memorySize: 1024,
            timeout: Duration.minutes(5), // limit: max 15 mins
            handler: 'ct_write_handler.handle',
            vpc: props.secureVpc,
            deadLetterQueueEnabled: true,
            role: this.CtLambdaBasicIamRole,
            reservedConcurrentExecutions: 1,
            code: Code.fromAsset(path.join(__dirname, '/../src/lambdas')),
            environment: {
                DDBTableArn: props.DataStoreStack.ddbTable.tableArn,
                REGION: Stack.of(this).region,
                LOG_LEVEL: 'INFO',
                AVAILABILITY_ZONES: JSON.stringify(
                    Stack.of(this).availabilityZones,
                ),
            },
        });

        new EventSourceMapping(scope, "CtEventSQSEventSourceMapping", {
            eventSourceArn: props.PubSubStack.CtEventsQueue.queueArn,
            target: this.CtEventsLambda,
            enabled: true,
            batchSize: props.lambdasConfig[CT_WRITE_LAMBDA_NAME].batchSize,
            maxBatchingWindow: props.lambdasConfig[CT_WRITE_LAMBDA_NAME].maxBatchingWindow,
            reportBatchItemFailures: true
        });

    }

    private createLambdaDashboard(fname: string, productionVariant: Function, mainQ: Queue, dlQ: Queue, stage: string) {
        const dashboard = new Dashboard(this, `${fname}-Dashboard-${stage}-${this.region}`);
        dashboard.addWidgets(
            new AlarmWidget({
                alarm: productionVariant.metricErrors({statistic: STATISTIC.SUM}).createAlarm(this,
                    `${fname}-${AlarmNames.LAMBDA_INVOCATION_ERRORS2}`, {
                        alarmName: `${fname}-LAMBDA_INVOCATION_ERRORS_SEV2`,
                        alarmDescription: `CT Lambda:${AlarmNames.LAMBDA_INVOCATION_ERRORS2} breached the threshold (${CT_WRITE_LAMBDA_INVOKE_ERRORS_THRESHOLD}). \n
                Refer the Service Runbook - ${SERVICE_RUNBOOK_LINK}`,
                        threshold: CT_WRITE_LAMBDA_INVOKE_ERRORS_THRESHOLD,
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

}