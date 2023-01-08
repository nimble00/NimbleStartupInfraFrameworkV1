import {Duration} from "aws-cdk-lib";
import {Metric, MetricConfig, Unit} from "aws-cdk-lib/aws-cloudwatch";


export const CW_DASHBOARD_ROLE_NAME = "CloudWatchDashboards"
export const CW_WIKI_AWS_ACCOUNT = "015580085211";
export const SERVICE_RUNBOOK_LINK = "https://w.amazon.com/bin/view/InternationalCountryExpansion/A2I/AbusePreventionTech/Projects/GRAF/Dashboard/";

export const MINUTES_1 = Duration.minutes(1)
export const MINUTES_5 = Duration.minutes(5)
export const MINUTES_10 = Duration.minutes(10)
export const MINUTES_15 = Duration.minutes(15)

export enum Namespace {
    SQS = "AWS/SQS",
    LMB = "AWS/Lambda",
    GrafRealtimeLambda = 'GrafRealtimeLambda',
    GrafRealtimeSagemaker = 'GrafRealtimeSagemaker'
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
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'DDBPersistError',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 20,
        sev2Action: true,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'InvalidCycleInputError',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 20,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'InvalidOrderDayDiffError',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 20,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'ModelInvokeFailure',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 20,
        sev2Action: true,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'NeptuneFetchError',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 40,
        sev2Action: true,
        evaluationPeriods: 15,
        datapointsToAlarm: 15,
        aggregateOver: Duration.seconds(60),
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'NeptunePersistError',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 20,
        sev2Action: true,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'InvalidEdgeFeatureInputError',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 10,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'SNSPublishError',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 20,
        sev2Action: true,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'InvalidInputError',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 20,
        sev2Action: true,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'INVALID_LAMBDA_INPUT',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 10,
        sev2Action: true,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'FEATURE_VALUE_PARSE_ERROR',
        statistic: STATISTIC.SUM,
        unit: Unit.COUNT,
        threshold: 10,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'DDB_FETCH_LATENCY',
        unit: Unit.MILLISECONDS,
        threshold: 350,
        sev2Action: true,
        statistic: STATISTIC.P99,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'DDB_PERSIST_LATENCY',
        unit: Unit.MILLISECONDS,
        threshold: 15,
        sev2Action: true,
        statistic: STATISTIC.TM99,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'MODEL_INVOKE_LATENCY',
        unit: Unit.MILLISECONDS,
        threshold: 1500,
        statistic: STATISTIC.P99,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'NEPTUNE_DEDUPLICATION_LATENCY',
        unit: Unit.MILLISECONDS,
        threshold: 1600,
        sev2Action: false,
        statistic: STATISTIC.TM99,
        sensitiveToBatchJobs: true,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'NEPTUNE_FETCH_LATENCY',
        unit: Unit.MILLISECONDS,
        threshold: 1000,
        sev2Action: true,
        statistic: STATISTIC.TM99,
        sensitiveToBatchJobs: true,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'NEPTUNE_PERSIST_LATENCY',
        unit: Unit.MILLISECONDS,
        threshold: 60,
        statistic: STATISTIC.TM99,
        sensitiveToBatchJobs: true,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'OTF_SNS_PUBLISH_LATENCY',
        unit: Unit.MILLISECONDS,
        threshold: 100,
        statistic: STATISTIC.P99,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'TOTAL_INFERENCE_LATENCY',
        unit: Unit.MILLISECONDS,
        threshold: 1500,
        sev2Action: true,
        statistic: STATISTIC.TM99,
        sensitiveToBatchJobs: true,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'TOTAL_INGEST_LATENCY',
        unit: Unit.MILLISECONDS,
        threshold: 80,
        statistic: STATISTIC.TM99,
        sensitiveToBatchJobs: true,
        namespace: Namespace.GrafRealtimeLambda
    },
    {
        name: 'SAGEMAKER_SNS_PUBLISH_SUCCESS',
        unit: Unit.MILLISECONDS,
        threshold: 100,
        statistic: STATISTIC.P99,
        namespace: Namespace.GrafRealtimeSagemaker
    },
    {
        name: 'SAGEMAKER_SNS_PUBLISH_ERROR',
        unit: Unit.MILLISECONDS,
        threshold: 10,
        statistic: STATISTIC.SUM,
        namespace: Namespace.GrafRealtimeSagemaker
    },
];
