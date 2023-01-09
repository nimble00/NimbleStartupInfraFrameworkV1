import {Duration} from "aws-cdk-lib";
import {MetricConfig, Unit} from "aws-cdk-lib/aws-cloudwatch";


export const CW_DASHBOARD_ROLE_NAME = "CloudWatchDashboards"
export const CW_WIKI_AWS_ACCOUNT = "987680081234";
export const SERVICE_RUNBOOK_LINK = "https://w.wishlink.com/bin/view/service_name/Dashboard/";

export const MINUTES_1 = Duration.minutes(1)
export const MINUTES_5 = Duration.minutes(5)
export const MINUTES_10 = Duration.minutes(10)
export const MINUTES_15 = Duration.minutes(15)

export enum Namespace {
    SQS = "AWS/SQS",
    LMB = "AWS/Lambda",
    CTB = 'ct_backend'
}

export enum STATISTIC {
    AVG = 'avg',
    MIN = 'min',
    MAX = 'max',
    N = 'n',
    P50 = 'p50',
    P90 = 'p90',
    P99 = 'p99',
    TM99 = 'tm99',
    P99_9 = 'p99.9',
    P100 = 'p100',
    SUM = 'sum',
};

export enum AlarmNames {
    CPU_UTILIZATION = 'CpuUtilization',
    MODEL_LATENCY = 'ModelLatency',
    DISK_UTILIZATION = 'DiskUtilization',
    MEMORY_UTILIZATION = 'MemoryUtilization',
    INVOCATION_4XX_ERRORS = 'Invocation4XXErrors',
    INVOCATION_5XX_ERRORS = 'Invocation5XXErrors',
    LAMBDA_INVOCATION_ERRORS2 = 'LambdaInvocation5XXErrorsSEV2',
    LAMBDA_INVOCATION_ERRORS3 = 'LambdaInvocation5XXErrorsSEV3'
}

export interface CustomMetricConfigProps extends MetricConfig{
    readonly name: string;
    readonly statistic: string;
    readonly unit: Unit;
    readonly threshold: number;
    readonly sev2Action?: boolean;
    readonly namespace: string;
    readonly evaluationPeriods?: number;
    readonly datapointsToAlarm?: number;
    readonly sensitiveToBatchJobs?: boolean;
    readonly aggregateOver?: Duration;
}

// (DAY(m1)!=3 OR HOUR(m1)!=22 OR MINUTE(m1)>30) => IST Thursday 3:30-4:00am (Neptune Maintenance Window)
// (HOUR(m1)!=20 OR MINUTE(m1)>45) => Everyday 1:30-2:15am (Neptune Purge Job)
export const ALARM_ACTIVE_OUTSIDE_MAINT_AND_BATCH_JOBS_MATH_EXPR = 'IF((DAY(m1)!=3 OR HOUR(m1)!=22 OR MINUTE(m1)>30) AND (HOUR(m1)!=20 OR MINUTE(m1)>45), m1)';

export const CustomMetricsConfig: CustomMetricConfigProps[] = [
    {
        name: 'DDBFetchError',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 20,
        sev2Action: true,
        aggregateOver: Duration.seconds(60),
        namespace: Namespace.CTB
    },
    {
        name: 'DDBPersistError',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 20,
        sev2Action: true,
        namespace: Namespace.CTB
    },
    {
        name: 'InvalidInputError',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 20,
        namespace: Namespace.CTB
    },
    {
        name: 'SNSPublishError',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 20,
        sev2Action: true,
        namespace: Namespace.CTB
    },
    {
        name: 'InvalidInputError',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 20,
        sev2Action: true,
        namespace: Namespace.CTB
    },
    {
        name: 'VALUE_PARSE_ERROR',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 10,
        namespace: Namespace.CTB
    },
    {
        name: 'DDB_FETCH_LATENCY',
        unit: Unit.MILLISECONDS,
        threshold: 350,
        sev2Action: true,
        statistic: STATISTIC.P99,
        namespace: Namespace.CTB
    },
    {
        name: 'DDB_PERSIST_LATENCY',
        unit: Unit.MILLISECONDS,
        threshold: 15,
        sev2Action: true,
        statistic: STATISTIC.TM99,
        namespace: Namespace.CTB
    }
];
