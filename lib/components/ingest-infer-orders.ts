import {App, Duration, Stack} from "aws-cdk-lib";
import {Queue} from "aws-cdk-lib/aws-sqs";
import {ArnPrincipal, Effect, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {DeploymentEnvironment, DeploymentStack, DeploymentStackProps, SoftwareType} from "@amzn/pipelines";
import {VpcStack} from "../vpc";
import {Topic} from "aws-cdk-lib/aws-sns";
import {SqsSubscription} from "aws-cdk-lib/aws-sns-subscriptions";
import {Alarm, ComparisonOperator, MathExpression, Metric} from "aws-cdk-lib/aws-cloudwatch";
import {SIMTicketingAlarmAction, TicketSeverity} from "@amzn/alexa-ml-common-constructs";
import {CreateAlarmOptions} from "aws-cdk-lib/aws-cloudwatch/lib/metric";
import {
    team,
    INFER_ORDER_EVENTS_Q_NAME,
    INGEST_ORDER_EVENTS_Q_NAME,
    INFER_ORDER_EVENTS_DLQ_NAME,
    INGEST_ORDER_EVENTS_DLQ_NAME,
    STAGE
} from "../common/constants";
import {
    ALARM_ACTIVE_OUTSIDE_MAINT_AND_BATCH_JOBS_MATH_EXPR,
    AlarmNames,
    SERVICE_RUNBOOK_LINK
} from "../monitoring/constants";


export interface IngestOrderStackProps {
    readonly env: DeploymentEnvironment;
    readonly vpcStack: VpcStack;
    readonly suffix?: string;
    readonly stackName?: string;
    readonly stage: string;
    readonly modelRoleName?: string;
    readonly queuesConfig: any;
    readonly setupAlarms: boolean;
}

export class IngestOrderStack extends DeploymentStack {
    IngestOrderEventsQueueDLQ: Queue;
    IngestOrderEventsQueue: Queue;
    InferenceOrderEventsQueueDLQ: Queue;
    InferenceOrderEventsQueue: Queue;
    GrafTriggerEventsSNSTopic: Topic;
    RealtimeGrafScoresSNSTopic: Topic;
    alarms: Alarm[] = [];

    constructor(parent: App, name: string, props: IngestOrderStackProps) {
        super(parent, name, <DeploymentStackProps>{
            softwareType: SoftwareType.INFRASTRUCTURE,
            ...props
        });
        this.createRealtimeGrafScoresSNSTopic(this);
        this.createIngestAndInferenceQueue(this, props);
        this.createGrafTriggerEventsSNSTopic(this, props.modelRoleName);

        const ingestAlarmsConfig = this.getQueueAlarmsConfig(INGEST_ORDER_EVENTS_Q_NAME, this.IngestOrderEventsQueue, this.IngestOrderEventsQueueDLQ);
        const inferAlarmsConfig = this.getQueueAlarmsConfig(INFER_ORDER_EVENTS_Q_NAME, this.InferenceOrderEventsQueue, this.InferenceOrderEventsQueueDLQ);
        if (props.setupAlarms) {
            this.createQueueAlarms(INGEST_ORDER_EVENTS_Q_NAME, ingestAlarmsConfig, props.stage);
            this.createQueueAlarms(INFER_ORDER_EVENTS_Q_NAME, inferAlarmsConfig, props.stage);
        }
    }

    private createIngestAndInferenceQueue(scope: Stack, props: IngestOrderStackProps) {
        this.IngestOrderEventsQueueDLQ = new Queue(scope, `IngestOrderEventsQueueDLQ-${props.stage}`, {
                retentionPeriod: Duration.days(14),
                queueName: INGEST_ORDER_EVENTS_DLQ_NAME
            },
        );

        this.IngestOrderEventsQueue = new Queue(scope, `IngestOrderEventsQueue-${props.stage}`, {
            visibilityTimeout: Duration.seconds(1000),
            retentionPeriod: Duration.days(14),
            queueName: INGEST_ORDER_EVENTS_Q_NAME,
            deadLetterQueue: {
                queue: this.IngestOrderEventsQueueDLQ,
                maxReceiveCount: 5
            },
            deliveryDelay: props.queuesConfig[INGEST_ORDER_EVENTS_Q_NAME].deliveryDelay
        });

        this.InferenceOrderEventsQueueDLQ = new Queue(scope, `InferenceOrderEventsQueueDLQ-${props.stage}`, {
                retentionPeriod: Duration.days(14),
                queueName: INFER_ORDER_EVENTS_DLQ_NAME
            },
        );

        this.InferenceOrderEventsQueue = new Queue(scope, `InferenceOrderEventsQueue-${props.stage}`, {
            visibilityTimeout: Duration.minutes(20),
            retentionPeriod: Duration.days(7),
            queueName: INFER_ORDER_EVENTS_Q_NAME,
            deadLetterQueue: {
                queue: this.InferenceOrderEventsQueueDLQ,
                maxReceiveCount: 3
            },
            deliveryDelay: props.queuesConfig[INFER_ORDER_EVENTS_Q_NAME].deliveryDelay
        });

    }

    private getQueueAlarmsConfig(qName: string, queue: Queue, dlQueue: Queue) {
        // Choice of metrics to Alarm - https://www.bluematador.com/blog/how-to-monitor-amazon-sqs-with-cloudwatch
        const oldestMsgThreshold = qName == INGEST_ORDER_EVENTS_Q_NAME ? 2000 : 1000;
        const oldestMsgExprMetric = new MathExpression({
            expression: `IF((m1>${oldestMsgThreshold}), m2, 0)`,
            usingMetrics: {
                'm1': queue.metricApproximateAgeOfOldestMessage(),
                'm2': queue.metricApproximateNumberOfMessagesVisible()
            }
        });
        return [
            // Alarm buzzes when publisher is unhealthy
            {
                metric: queue.metricNumberOfMessagesSent(),
                alarmName: `${qName}-${queue.metricNumberOfMessagesSent().metricName} Alarm`,
                alarmDescription: `${queue.metricNumberOfMessagesSent().metricName} too low! Please check Publishers' health status.`,
                comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
                evaluationPeriods: 10,
                threshold: 200,
                sev2Action: false
            },
            // Alarm buzzes when consumer is unhealthy
            {
                metric: oldestMsgExprMetric,
                alarmName: `${qName}-${queue.metricApproximateAgeOfOldestMessage().metricName} SEV2 Alarm`,
                alarmDescription: `${queue.metricApproximateAgeOfOldestMessage().metricName} too high! Please check Consumers' health status.`,
                comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
                evaluationPeriods: 4,
                threshold: 20,
                sev2Action: true
            },
            // Alarm buzzes when DLQ has messages
            {
                metric: dlQueue.metricApproximateNumberOfMessagesVisible(),
                alarmName: `${qName}-${dlQueue.metricApproximateNumberOfMessagesVisible().metricName} Alarm`,
                alarmDescription: `${dlQueue.metricApproximateNumberOfMessagesVisible().metricName} greater than ZERO. Is consumer down?`,
                comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
                evaluationPeriods: 1,
                threshold: 0,
                sev2Action: true
            }
        ];
    }

    private createQueueAlarms(qName: string, qAlarmConfig: any[], stage: string) {
        let alarms: Alarm[] = [];
        let alarmsSev2: Alarm[] = [];

        qAlarmConfig.forEach(alarmConf => {
                const metricC: Metric = alarmConf.metric;
                const alarmId = alarmConf.sev2Action ? `${qName}-${metricC.metricName}Sev2` : `${qName}-${metricC.metricName}Sev3`;
                const alarm = metricC.createAlarm(
                    this,
                    alarmId,
                    <CreateAlarmOptions>{
                        ...alarmConf,
                        alarmDescription: `GRAF Lambda:${metricC.metricName} breached the threshold.\n Refer the Service Runbook - ${SERVICE_RUNBOOK_LINK}`
                    }
                );
                if (alarmConf.sev2Action) {
                    alarmsSev2.push(alarm);
                } else {
                    alarms.push(alarm);
                }
            }
        );

        const alarmActionSev3 = new SIMTicketingAlarmAction({
            severity: TicketSeverity.SEV3,
            cti: team.cti,
            resolverGroup: team.group
        });
        const alarmActionSev2 = new SIMTicketingAlarmAction({
            severity: TicketSeverity.SEV2_5,
            cti: team.cti,
            resolverGroup: team.group
        });
        if (stage == 'Prod') {
            alarms.forEach(alarm => alarm.addAlarmAction(alarmActionSev3));
            alarmsSev2.forEach(alarm => alarm.addAlarmAction(alarmActionSev2));
        }
        this.alarms.push(...alarms);
        this.alarms.push(...alarmsSev2);
    }

    private createGrafTriggerEventsSNSTopic(scope: Stack, modelRoleName: string | undefined) {
        const grafTriggerEventsSNSTopic = new Topic(scope, "GrafTriggerEventsSNSTopic", {
            topicName: "GrafTriggerEventsSNSTopic"
        });

        grafTriggerEventsSNSTopic.addToResourcePolicy(
            new PolicyStatement({
                sid: 'GrafSagemakerToSNSPublishAccessPolicy',
                effect: Effect.ALLOW,
                actions: ["sns:Publish"],
                principals: [
                    new ArnPrincipal(`arn:aws:sts::${this.account}:assumed-role/${modelRoleName}/SageMaker`),
                ],
                resources: [grafTriggerEventsSNSTopic.topicArn]
            })
        );

        grafTriggerEventsSNSTopic.addSubscription(new SqsSubscription(this.IngestOrderEventsQueue, {rawMessageDelivery: true}));
        grafTriggerEventsSNSTopic.addSubscription(new SqsSubscription(this.InferenceOrderEventsQueue, {rawMessageDelivery: true}));

        this.GrafTriggerEventsSNSTopic = grafTriggerEventsSNSTopic;
    }

    private createRealtimeGrafScoresSNSTopic(scope: Stack) {
        this.RealtimeGrafScoresSNSTopic = new Topic(scope, "RealtimeGrafScoresSNSTopic", {
            topicName: "RealtimeGrafScoresSNSTopic"
        });
    }

}
