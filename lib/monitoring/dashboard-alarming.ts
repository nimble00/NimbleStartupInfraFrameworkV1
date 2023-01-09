import {
    Alarm, AlarmWidget,
    Dashboard,
    GraphWidget,
    MathExpression,
    Metric,
    TreatMissingData
} from "aws-cdk-lib/aws-cloudwatch";
import {App, Duration, Environment, Stack} from "aws-cdk-lib";
import {
    ALARM_ACTIVE_OUTSIDE_MAINT_AND_BATCH_JOBS_MATH_EXPR,
    CustomMetricConfigProps,
    CustomMetricsConfig, SERVICE_RUNBOOK_LINK
} from "./telemetry-constants";
import {joinStrings} from "../common/utils";


export interface MonitorDashboardStackProps {
    readonly suffix: string;
    readonly env: Environment;
    readonly stage: string;
    readonly allAlarms: Alarm[];
}

export class MonitorDashboardStack extends Stack {

    constructor(parent: App, name: string, props: MonitorDashboardStackProps) {
        super(parent, name, {
            ...props
        });

        const customMetrics: Metric[] = this.registerCustomMetricsAndCreateAlarms(props.stage);
        this.createCustomDashboard(customMetrics, props);
        this.createAlarmViewDashboard(props.allAlarms, props);
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
        return customMetrics;
    }

    private createAlarmForMetric(metric: any, metricConfig: CustomMetricConfigProps) {
        return metric.createAlarm(this, `CT${metricConfig.name}Alarm-${this.region}`, {
            alarmName: `CT-${metricConfig.name}Alarm`,
            alarmDescription: `CT:${metricConfig.name} breached the threshold (${metricConfig.threshold}). \n
            Refer the Service Runbook - ${SERVICE_RUNBOOK_LINK}`,
            evaluationPeriods: metricConfig.evaluationPeriods == undefined ? 5 : metricConfig.evaluationPeriods,
            threshold: metricConfig.threshold,
            datapointsToAlarm: metricConfig.datapointsToAlarm,
            treatMissingData: TreatMissingData.NOT_BREACHING
        });
    }

    private createCustomDashboard(metrics: Metric[], props: MonitorDashboardStackProps) {
        const dashboard = new Dashboard(this, joinStrings(`CTCodebaseMetricsDashboard`, props.suffix));
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

    private createAlarmViewDashboard(alarms: Alarm[], props: MonitorDashboardStackProps) {
        const dashboard = new Dashboard(this, joinStrings(`CTAlarmsOverviewDashboard`, props.suffix));
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

