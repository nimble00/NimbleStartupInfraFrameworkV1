import {App, Environment, Stack, StackProps} from "aws-cdk-lib";
import {AttributeType, BillingMode, Operation, Table, TableEncryption} from "aws-cdk-lib/aws-dynamodb";
import {VpcStack} from "../vpc";
import {Dashboard, GraphWidget} from "aws-cdk-lib/aws-cloudwatch";
import {MINUTES_1, MINUTES_5, STATISTIC} from "../monitoring/constants";
import {
    CLICK_THRU_DDB_TABLE_NAME,
    CLICK_THRU_DDB_TABLE_PRIMARY_KEY,
    CLICK_THRU_DDB_TABLE_TTL_KEY
} from "../common/datastore-constants";

export interface DataStoresProps extends StackProps {
    readonly env: Environment;
    readonly vpcStack: VpcStack;
    readonly suffix?: string;
    readonly stackName?: string;
    readonly stage: string;
    /**
     * Stack tags that will be applied to all the taggable resources and the stack itself.
     *
     * @default {}
     */
    readonly tags?: {
        [key: string]: string;
    };
}


export class DataStoresStack extends Stack {

    public readonly ddbTable: Table;

    constructor(parent: App, name: string, props: DataStoresProps) {
        super(parent, name, <StackProps>{
            ...props
        });

        this.ddbTable = new Table(this, CLICK_THRU_DDB_TABLE_NAME, {
            partitionKey: {name: CLICK_THRU_DDB_TABLE_PRIMARY_KEY, type: AttributeType.STRING},
            tableName: CLICK_THRU_DDB_TABLE_NAME,
            timeToLiveAttribute: CLICK_THRU_DDB_TABLE_TTL_KEY,
            pointInTimeRecovery: true,
            encryption: TableEncryption.AWS_MANAGED,
            billingMode: BillingMode.PAY_PER_REQUEST
        });
        this.createDdbDashboard(this.ddbTable, props.stage);

    }

    private createDdbDashboard(ddbTable: Table, stage: string) {
        const dashboard = new Dashboard(this, `DynamoDB-Dashboard-${stage}-${this.region}`);
        dashboard.addWidgets(
            new GraphWidget({
                title: 'ConsumedReadCapacityUnits',
                right: [
                    ddbTable.metricConsumedReadCapacityUnits({
                        statistic: STATISTIC.SUM,
                        period: MINUTES_5
                    })
                ],
                left: [
                    ddbTable.metricConsumedReadCapacityUnits({
                        statistic: STATISTIC.MAX,
                        period: MINUTES_5
                    }),
                    ddbTable.metricConsumedReadCapacityUnits({
                        statistic: STATISTIC.AVG,
                        period: MINUTES_5
                    })
                ]
            }),
            new GraphWidget({
                title: 'ConsumedWriteCapacityUnits',
                right: [
                    ddbTable.metricConsumedWriteCapacityUnits({
                        statistic: STATISTIC.SUM,
                        period: MINUTES_5
                    })
                ],
                left: [
                    ddbTable.metricConsumedWriteCapacityUnits({
                        statistic: STATISTIC.MAX,
                        period: MINUTES_5
                    }),
                    ddbTable.metricConsumedWriteCapacityUnits({
                        statistic: STATISTIC.AVG,
                        period: MINUTES_5
                    })
                ]
            }),
            new GraphWidget({
                title: 'SuccessfulRequestLatency',
                left: [
                    ddbTable.metricSuccessfulRequestLatency({
                        statistic: STATISTIC.P90,
                        dimensionsMap:{
                            TableName: CLICK_THRU_DDB_TABLE_NAME,
                            Operation: Operation.BATCH_GET_ITEM
                        },
                        period: MINUTES_5
                    }),
                    ddbTable.metricSuccessfulRequestLatency({
                        statistic: STATISTIC.P99,
                        dimensionsMap:{
                            TableName: CLICK_THRU_DDB_TABLE_NAME,
                            Operation: Operation.BATCH_GET_ITEM
                        },
                        period: MINUTES_5
                    }),
                    ddbTable.metricSuccessfulRequestLatency({
                        statistic: STATISTIC.P99_9,
                        dimensionsMap:{
                            TableName: CLICK_THRU_DDB_TABLE_NAME,
                            Operation: Operation.BATCH_GET_ITEM
                        },
                        period: MINUTES_5
                    })
                ]
            }),
            new GraphWidget({
                title: 'SuccessfulRequestLatency',
                left: [
                    ddbTable.metricSuccessfulRequestLatency({
                        statistic: STATISTIC.P90,
                        dimensionsMap:{
                            TableName: CLICK_THRU_DDB_TABLE_NAME,
                            Operation: Operation.PUT_ITEM
                        },
                        period: MINUTES_5
                    }),
                    ddbTable.metricSuccessfulRequestLatency({
                        statistic: STATISTIC.P99,
                        dimensionsMap:{
                            TableName: CLICK_THRU_DDB_TABLE_NAME,
                            Operation: Operation.PUT_ITEM
                        },
                        period: MINUTES_5
                    }),
                    ddbTable.metricSuccessfulRequestLatency({
                        statistic: STATISTIC.P99_9,
                        dimensionsMap:{
                            TableName: CLICK_THRU_DDB_TABLE_NAME,
                            Operation: Operation.PUT_ITEM
                        },
                        period: MINUTES_5
                    })
                ]
            }),
            new GraphWidget({
                title: 'ThrottledRequestsForOperation',
                left: [
                    ddbTable.metricThrottledRequestsForOperation(Operation.BATCH_GET_ITEM, {
                        statistic: STATISTIC.SUM,
                        period: MINUTES_1
                    }),
                    ddbTable.metricThrottledRequestsForOperation(Operation.BATCH_GET_ITEM, {
                        statistic: STATISTIC.N,
                        period: MINUTES_1
                    })
                ],
                right: [
                    ddbTable.metricThrottledRequestsForOperation(Operation.PUT_ITEM, {
                        statistic: STATISTIC.SUM,
                        period: MINUTES_1
                    }),
                    ddbTable.metricThrottledRequestsForOperation(Operation.PUT_ITEM, {
                        statistic: STATISTIC.N,
                        period: MINUTES_1
                    })
                ],
            })
        );

    }

}
