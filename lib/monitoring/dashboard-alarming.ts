import {
    Alarm, AlarmWidget,
    Dashboard,
    GraphWidget,
    MathExpression,
    Metric,
    TreatMissingData
} from "aws-cdk-lib/aws-cloudwatch";
import {
    ALARM_ACTIVE_OUTSIDE_MAINT_AND_BATCH_JOBS_MATH_EXPR, CustomMetricConfigProps,
    CustomMetricsConfig, SERVICE_RUNBOOK_LINK,
} from "../monitoring/constants";
import {App, Duration} from "aws-cdk-lib";
import {DeploymentEnvironment, DeploymentStack, SoftwareType} from "@amzn/pipelines";
import {SIMTicketingAlarmAction, TicketSeverity} from "@amzn/alexa-ml-common-constructs";
import {STAGE, team} from "../common/constants";
import {createOrdersCreatedMetric} from "../common/utils";


export interface MonitorDashboardStackProps {
    readonly env: DeploymentEnvironment;
    readonly stage: string;
    readonly allAlarms: Alarm[];
}

export class MonitorDashboardStack extends DeploymentStack {
    readonly orderRateMetric: Metric;

    constructor(parent: App, name: string, props: MonitorDashboardStackProps) {
        super(parent, name, {
            softwareType: SoftwareType.INFRASTRUCTURE,
            ...props
        });

        if (props.stage === STAGE.PROD) {
            this.orderRateMetric = createOrdersCreatedMetric();
        }
        const customMetrics: Metric[] = this.registerCustomMetricsAndCreateAlarms(props.stage);
        this.createCustomDashboard(customMetrics, props.stage, props.env.region);
        this.createAlarmViewDashboard(props.allAlarms, props.stage, props.env.region);
    }

    private registerCustomMetricsAndCreateAlarms(stage: string) {
        let alarms: Alarm[] = [];
        let alarmsSEV2: Alarm[] = [];
        let customMetrics: Metric[] = [];

        CustomMetricsConfig.forEach(metricConfig => {
            const metric = new Metric({
                metricName: metricConfig.name,
                period: metricConfig.aggregateOver ? metricConfig.aggregateOver : Duration.minutes(5),
                statistic: metricConfig.statistic,
                unit: metricConfig.unit,
                namespace: metricConfig.namespace
            });

            if (metricConfig.sensitiveToBatchJobs) {
                const exprMetric = new MathExpression({
                    expression: ALARM_ACTIVE_OUTSIDE_MAINT_AND_BATCH_JOBS_MATH_EXPR,
                    usingMetrics: {'m1': metric}
                });
                alarmsSEV2.push(this.createAlarmForMetric(exprMetric, metricConfig));
            } else if (metricConfig.sev2Action) {
                alarmsSEV2.push(this.createAlarmForMetric(metric, metricConfig));
            } else {
                alarms.push(this.createAlarmForMetric(metric, metricConfig));
            }

            customMetrics.push(metric);
        });

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
            alarmsSEV2.forEach(alarm => alarm.addAlarmAction(alarmActionSev2));
        }
        return customMetrics;
    }

    private createAlarmForMetric(metric: any, metricConfig: CustomMetricConfigProps) {
        return metric.createAlarm(this, `Graf${metricConfig.name}Alarm-${this.region}`, {
            alarmName: `Graf${metricConfig.name}Alarm`,
            alarmDescription: `GRAFRT:${metricConfig.name} breached the threshold (${metricConfig.threshold}). \n
            Refer the Service Runbook - ${SERVICE_RUNBOOK_LINK}`,
            evaluationPeriods: metricConfig.evaluationPeriods == undefined ? 5 : metricConfig.evaluationPeriods,
            threshold: metricConfig.threshold,
            datapointsToAlarm: metricConfig.datapointsToAlarm,
            treatMissingData: TreatMissingData.NOT_BREACHING
        });
    }

    private createCustomDashboard(metrics: Metric[], stage: string, region: string) {
        const dashboard = new Dashboard(this, `GrafRTCodebaseMetricsDashboard-${stage}-${region}`);
        metrics.forEach(metric => {
            dashboard.addWidgets(
                new GraphWidget({
                    title: metric.namespace,
                    left: [metric],
                    statistic: metric.statistic,
                    period: Duration.minutes(5)
                }),
            )
        });
    }

    private createAlarmViewDashboard(alarms: Alarm[], stage: string, region: string) {
        const dashboard = new Dashboard(this, `GrafAlarmsOverviewDashboard-${stage}-${region}`);
        alarms.forEach(alarm => {
            dashboard.addWidgets(
                new AlarmWidget({
                    title: alarm.alarmName,
                    alarm
                }),
            )
        });
    }

}

