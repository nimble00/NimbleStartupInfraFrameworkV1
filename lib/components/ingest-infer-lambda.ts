import {App, Duration, Environment, Stack, StackProps} from "aws-cdk-lib";
import {Queue} from "aws-cdk-lib/aws-sqs";
import {Vpc} from "aws-cdk-lib/aws-ec2";
import {
    ArnPrincipal,
    CompositePrincipal,
    Effect,
    ManagedPolicy,
    PolicyDocument,
    PolicyStatement,
    Role,
    ServicePrincipal
} from "aws-cdk-lib/aws-iam";
import {EventSourceMapping, Function, Handler, Runtime} from "aws-cdk-lib/aws-lambda";
import {getLambdaAssetPackage, getLambdaExperimentPackage} from "../packages";
import {Alarm, Dashboard, GraphWidget, TreatMissingData} from "aws-cdk-lib/aws-cloudwatch";
import {AlarmNames, SERVICE_RUNBOOK_LINK, STATISTIC} from "../monitoring/constants";
import {DataStoresStack} from "./data-stores";
import {IngestOrderStack} from "./ingest-infer-orders";
import {isExperiment} from "../common/utils";


export interface IngestInferLambdaStackProps {
    readonly env: Environment;
    readonly stage: string;
    readonly secureVpc: Vpc;
    readonly dgSuffix: string;
    readonly IngestInferObserverStack: IngestOrderStack;
    readonly DataStoreStack: DataStoresStack;
    readonly lambdasConfig: any;
    readonly setupAlarms: boolean;
}


export class IngestInferLambdaStack extends Stack {

    IngestEventsLambda: Function;
    IngestLambdaBasicIamRole: Role;
    InferenceEventsLambda: Function;
    InferenceLambdaBasicIamRole: Role;
    NeptuneIamRole: Role;
    alarms: Alarm[] = [];

    constructor(parent: App, name: string, props: IngestInferLambdaStackProps) {
        super(parent, name, <StackProps>{
            ...props
        });

        this.createLambdaIamRolesAndNeptuneIamRole(this, props);
        this.createIngestLambdaAndMapping(this, props);
        this.createInferenceLambdaAndMapping(this, props);

        this.createIntegrationTestingInfra(this, props);

        this.createLambdaDashboard('IngestEventsLambda', this.IngestEventsLambda, props.IngestInferObserverStack.IngestOrderEventsQueue, props.IngestInferObserverStack.IngestOrderEventsQueueDLQ, props.stage);
        this.createLambdaDashboard('InferenceEventsLambda', this.InferenceEventsLambda, props.IngestInferObserverStack.InferenceOrderEventsQueue, props.IngestInferObserverStack.InferenceOrderEventsQueueDLQ, props.stage);
        if (props.setupAlarms) {
            this.createLambdaAlarms('IngestEventsLambda', this.IngestEventsLambda, props.stage);
            this.createLambdaAlarms('InferenceEventsLambda', this.InferenceEventsLambda, props.stage);
        }
    }

    private createLambdaIamRolesAndNeptuneIamRole(scope: Stack, props: IngestInferLambdaStackProps) {

        this.IngestLambdaBasicIamRole = new Role(scope, `IngestLambdaBasicIamRole-${props.dgSuffix}`, {
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
                                props.IngestInferObserverStack.IngestOrderEventsQueue.queueArn, props.IngestInferObserverStack.IngestOrderEventsQueueDLQ.queueArn
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

        this.InferenceLambdaBasicIamRole = new Role(scope, `InferenceLambdaBasicIamRole-${props.dgSuffix}`, {
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
                            actions: ["dynamodb:BatchGet*"],
                            resources: [props.DataStoreStack.ddbTable.tableArn]
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ["sqs:ReceiveMessage", "sqs:GetQueueAttributes", "sqs:SendMessage", "sqs:DeleteMessage"],
                            resources: [
                                props.IngestInferObserverStack.InferenceOrderEventsQueue.queueArn, props.IngestInferObserverStack.InferenceOrderEventsQueueDLQ.queueArn
                            ]
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ["sns:Publish", "sns:GetTopicAttributes", "sns:ListTopics"],
                            resources: [props.IngestInferObserverStack.RealtimeGrafScoresSNSTopic.topicArn]
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ["cloudwatch:PutMetricData"],
                            resources: ["*"]
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: ['s3:PutObject', 's3:ListBucket'],
                            resources: ['arn:aws:s3:::graf-inference-io-debug']
                        })
                    ]
                })
            }
        });

        this.NeptuneIamRole = new Role(scope, `GrafIamRole-${props.dgSuffix}`, {
            assumedBy: new CompositePrincipal(
                new ArnPrincipal(this.IngestLambdaBasicIamRole.roleArn),
                new ArnPrincipal(this.InferenceLambdaBasicIamRole.roleArn)
            ),
            inlinePolicies: {
                'GrafIamAuthCustomPolicy': new PolicyDocument({
                    statements: [new PolicyStatement({
                        effect: Effect.ALLOW,
                        actions: ["neptune-db:*"],
                        resources: [`arn:aws:neptune-db:${scope.region}:${scope.account}:${props.DataStoreStack.neptuneCluster.clusterResourceIdentifier}/*`]
                    })]
                })
            }
        });
    }

    private createIngestLambdaAndMapping(scope: Stack, props: IngestInferLambdaStackProps) {

        const lambdaImageCode = .fromEcr({
            image: ,
            cmd: ['graf_realtime_stream_lambda.ingestion_handler.handle_ingestion']
        })

        const lambdaExperimentImageCode = LambdaImageAsset.fromEcr({
            image: ImageAsset.ecrImageFromBrazil({
                brazilPackage: getLambdaExperimentPackage(),
                componentName: 'GrafIngestExperCode',
            }),
            cmd: ['graf_realtime_experiments.ingestion_handler.handle_ingestion']
        })

        this.IngestEventsLambda = new Function(scope, "GrafRTLambdaFunction", {
            functionName: INGEST_LAMBDA_NAME,
            description: 'IngestEventsLambda invokes GRAF model and persists data in Neptune and DDB ',
            code: isExperiment(props.env.region) ? lambdaExperimentImageCode : lambdaImageCode,
            environment: {
                NeptuneIamRoleArn: this.NeptuneIamRole.roleArn,
                OrderFeaturesDDBTableArn: props.DataStoreStack.ddbTable.tableArn,
                NeptuneEndpointHostname: props.DataStoreStack.neptuneCluster.clusterEndpoint.hostname,
                NeptuneEndpointPort: props.DataStoreStack.neptuneCluster.clusterEndpoint.port.toString(),
                RealtimeGrafScoresSNSTopic: props.IngestInferObserverStack.RealtimeGrafScoresSNSTopic.topicArn,
                AWS_SERVICE_REGION: props.env.region
            },
            handler: Handler.FROM_IMAGE,
            memorySize: 1024,
            vpc: props.secureVpc,
            runtime: Runtime.FROM_IMAGE,
            deadLetterQueueEnabled: true,
            role: this.IngestLambdaBasicIamRole,
            reservedConcurrentExecutions: 1,
            timeout: Duration.minutes(15),
        })

        new EventSourceMapping(scope, "IngestEventSQSEventSourceMapping", {
            eventSourceArn: props.IngestInferObserverStack.IngestOrderEventsQueue.queueArn,
            target: this.IngestEventsLambda,
            enabled: true,
            batchSize: props.lambdasConfig[INGEST_LAMBDA_NAME].batchSize,
            maxBatchingWindow: props.lambdasConfig[INGEST_LAMBDA_NAME].maxBatchingWindow,
            reportBatchItemFailures: true
        });

    }

    private createInferenceLambdaAndMapping(scope: Stack, props: IngestInferLambdaStackProps) {

        const lambdaImageCode = LambdaImageAsset.fromEcr({
            image: ImageAsset.ecrImageFromBrazil({
                brazilPackage: getLambdaAssetPackage(),
                componentName: 'GrafRTInferLambdaCode',
            }),
            cmd: ['graf_realtime_stream_lambda.inference_handler.handle_inference']
        })

        const lambdaExperimentImageCode = LambdaImageAsset.fromEcr({
            image: ImageAsset.ecrImageFromBrazil({
                brazilPackage: getLambdaExperimentPackage(),
                componentName: 'GrafRTInferExperCode',
            }),
            cmd: ['graf_realtime_experiments.inference_handler.handle_inference']
        })

        this.InferenceEventsLambda = new Function(scope, "GrafRTInferenceLambdaFunction", {
            functionName: INFERENCE_LAMBDA_NAME,
            description: 'GrafRealtimeInferenceLambda invokes GRAF Model and Publishes the Scores to OTF',
            code: isExperiment(props.env.region) ? lambdaExperimentImageCode : lambdaImageCode,
            environment: {
                NeptuneIamRoleArn: this.NeptuneIamRole.roleArn,
                OrderFeaturesDDBTableArn: props.DataStoreStack.ddbTable.tableArn,
                NeptuneEndpointHostname: props.DataStoreStack.neptuneCluster.clusterReadEndpoint.hostname,
                NeptuneEndpointPort: props.DataStoreStack.neptuneCluster.clusterReadEndpoint.port.toString(),
                RealtimeGrafScoresSNSTopic: props.IngestInferObserverStack.RealtimeGrafScoresSNSTopic.topicArn,
                AWS_SERVICE_REGION: props.env.region,
                INFERENCE_IO_DEBUG: 'F',
                NEPTUNE_EVALUATION_TIMEOUT: '5000',
                NEPTUNE_DROP_QUERY_TIMEOUT: '200000',
                ab_MOD: '11',
                ab_minVal: '1'
            },
            handler: Handler.FROM_IMAGE,
            memorySize: 1024,
            vpc: props.secureVpc,
            runtime: Runtime.FROM_IMAGE,
            deadLetterQueueEnabled: true,
            role: this.InferenceLambdaBasicIamRole,
            reservedConcurrentExecutions: 100,
            timeout: Duration.minutes(15),
        })

        new EventSourceMapping(scope, "InferenceEventSQSEventSourceMapping", {
            eventSourceArn: props.IngestInferObserverStack.InferenceOrderEventsQueue.queueArn,
            target: this.InferenceEventsLambda,
            enabled: true,
            batchSize: props.lambdasConfig[INFERENCE_LAMBDA_NAME].batchSize,
            maxBatchingWindow: props.lambdasConfig[INFERENCE_LAMBDA_NAME].maxBatchingWindow,
            reportBatchItemFailures: true
        });

    }

    private createIntegrationTestingInfra(scope: Stack, props: IngestInferLambdaStackProps) {
        this.hydraResources = new HydraTestRunResources(scope, `HydraTestRunResources-${props.dgSuffix}`, {
            hydraEnvironment: props.env.hydraEnvironment,
            hydraAsset: {
                targetPackage: BrazilPackage.fromString('GrafRealtimeIntegrationTests-1.0/mainline')
            }
        });

        this.hydraResources.invocationRole.addToPolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['cloudwatch:GetMetricData', 'sqs:ReceiveMessage', 'sqs:GetQueueAttributes', 'sqs:SendMessage', 'sqs:DeleteMessage'],
            resources: [
                props.IngestInferObserverStack.InferenceOrderEventsQueue.queueArn,
                props.IngestInferObserverStack.IngestOrderEventsQueue.queueArn,
                props.IngestInferObserverStack.InferenceOrderEventsQueueDLQ.queueArn,
                props.IngestInferObserverStack.IngestOrderEventsQueueDLQ.queueArn
            ]
        }));

        this.hydraResources.invocationRole.addToPolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['cloudwatch:GetMetricData', 'cloudwatch:PutMetricData', 'logs:GetLogEvents', 'logs:PutLogEvents'],
            resources: ['*']
        }));

        this.hydraResources.invocationRole.addToPolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
            resources: [props.DataStoreStack.ddbTable.tableArn]
        }));

        this.InferenceEventsLambda.grantInvoke(this.hydraResources.invocationRole);
        this.IngestEventsLambda.grantInvoke(this.hydraResources.invocationRole);
    }

    private createLambdaDashboard(fname: string, productionVariant: Function, mainQ: Queue, dlQ: Queue, stage: string) {
        const dashboard = new Dashboard(this, `${fname}-Dashboard-${stage}-${this.region}`);
        dashboard.addWidgets(
            new GraphWidget({title: 'Lambda Duration', left: [productionVariant.metricDuration()]}),
            new GraphWidget({title: 'Lambda Invocation Errors', left: [productionVariant.metricErrors()]}),
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
                alarmDescription: `GRAF Lambda:${AlarmNames.LAMBDA_INVOCATION_ERRORS2} breached the threshold (${50}). \n
                Refer the Service Runbook - ${SERVICE_RUNBOOK_LINK}`,
                threshold: 50,
                evaluationPeriods: 5,
                treatMissingData: TreatMissingData.NOT_BREACHING
            })
        );

        const alarmActionSev2_5 = new SIMTicketingAlarmAction({
            severity: TicketSeverity.SEV2_5,
            cti: team.cti,
            resolverGroup: team.group
        });
        if (stage == 'Prod') {
            alarmsSev2_5.forEach(alarm => alarm.addAlarmAction(alarmActionSev2_5));
        }

        this.alarms.push(...alarmsSev2_5);
    }

}