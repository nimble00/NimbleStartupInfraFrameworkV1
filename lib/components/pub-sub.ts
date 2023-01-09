import {App, Duration, Environment, Stack, StackProps} from "aws-cdk-lib";
import {Queue} from "aws-cdk-lib/aws-sqs";
import {VpcStack} from "./vpc";
import {Topic} from "aws-cdk-lib/aws-sns";
import {Alarm, ComparisonOperator, MathExpression, Metric} from "aws-cdk-lib/aws-cloudwatch";
import {CreateAlarmOptions} from "aws-cdk-lib/aws-cloudwatch/lib/metric";
import {EventBus, Rule} from "aws-cdk-lib/aws-events";
import {
    CLICK_THRU_EVENT_BUS_NAME,
    CLICK_THRU_EVENTS_DLQ_NAME,
    CLICK_THRU_EVENTS_Q_NAME,
    CLICK_THRU_SNS_NAME
} from "../common/pubsub-constants";
import {Namespace, SERVICE_RUNBOOK_LINK} from "../monitoring/telemetry-constants";
import {joinStrings} from "../common/utils";


export interface PubSubStackProps {
    readonly app: App;
    readonly env: Environment;
    readonly vpcStack: VpcStack;
    readonly suffix: string;
    readonly stage: string;
    readonly queuesConfig: any;
    readonly setupAlarms: boolean;
}

export class PubSubStack extends Stack {
    CtEventsDLQ: Queue;
    CtEventsQueue: Queue;
    ctSNSTopic: Topic;
    ctEventBus: EventBus;
    ctEbTriggerRule: Rule;
    alarms: Alarm[] = [];

    constructor(parent: App, name: string, props: PubSubStackProps) {
        super(parent, name, <StackProps>{
            ...props
        });
        this.createCtSNSTopicAndCtEventBus(this);
        this.createCtEventsQueue(this, props);

        const ingestAlarmsConfig = this.getQueueAlarmsConfig(CLICK_THRU_EVENTS_Q_NAME, this.CtEventsQueue, this.CtEventsDLQ);
        if (props.setupAlarms) {
            this.createQueueAlarms(CLICK_THRU_EVENTS_Q_NAME, ingestAlarmsConfig, props.stage);
        }
    }

    private createCtEventsQueue(scope: Stack, props: PubSubStackProps) {
        this.CtEventsDLQ = new Queue(scope, joinStrings(CLICK_THRU_EVENTS_DLQ_NAME, props.suffix), {
                retentionPeriod: Duration.days(14),
                queueName: CLICK_THRU_EVENTS_DLQ_NAME
            },
        );

        this.CtEventsQueue = new Queue(scope, joinStrings(CLICK_THRU_EVENTS_Q_NAME, props.suffix), {
            visibilityTimeout: Duration.seconds(1000),
            retentionPeriod: Duration.days(14),
            queueName: CLICK_THRU_EVENTS_Q_NAME,
            deadLetterQueue: {
                queue: this.CtEventsDLQ,
                maxReceiveCount: 5
            },
            deliveryDelay: props.queuesConfig[CLICK_THRU_EVENTS_Q_NAME].deliveryDelay
        });
    }

    private getQueueAlarmsConfig(qName: string, queue: Queue, dlQueue: Queue) {
        // Choice of metrics to Alarm - https://www.bluematador.com/blog/how-to-monitor-amazon-sqs-with-cloudwatch
        const oldestMsgExprMetric = new MathExpression({
            expression: `IF((m1>2000), m2, 0)`,
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
                        alarmDescription: `CT Lambda:${metricC.metricName} breached the threshold.\n Refer the Service Runbook - ${SERVICE_RUNBOOK_LINK}`
                    }
                );
                if (alarmConf.sev2Action) {
                    alarmsSev2.push(alarm);
                } else {
                    alarms.push(alarm);
                }
            }
        );

        this.alarms.push(...alarms);
        this.alarms.push(...alarmsSev2);
    }

    private createCtSNSTopicAndCtEventBus(scope: Stack) {
        this.ctSNSTopic = new Topic(scope, CLICK_THRU_SNS_NAME, {
            topicName: CLICK_THRU_SNS_NAME
        });

        this.ctEventBus = new EventBus(this, CLICK_THRU_EVENT_BUS_NAME, {
            eventBusName: CLICK_THRU_EVENT_BUS_NAME
        });

        this.ctEbTriggerRule = new Rule(this, "CtTriggerRule", {
            description: "description",
            eventPattern: {
                source: [Namespace.LMB, Namespace.CTB],
                resources: ["r1", "r2"],
                detail: {
                    hello: [1],
                    foo: ["bar"]
                }

            },
            eventBus: this.ctEventBus
        });
    }

}
