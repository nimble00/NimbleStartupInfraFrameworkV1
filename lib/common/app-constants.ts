import {QUEUES_CONFIG} from "./pubsub-constants";
import {LAMBDAS_CONFIG} from "./compute-constants";
import {STAGE} from "./base-constants";

export const APPLICATION_NAME = 'APP_NAME';
export const APP_ACC_ID = '>AWS_ACC_ID<';
export const DEVO_ACC_ID = '>AWS_ACC_ID<';
export const GAMMA_ACC_ID = '>AWS_ACC_ID<'; // Can be same as DEVO unless significant scale differences
export const PROD_ACC_ID = '>AWS_ACC_ID<';

export const STAGES_CONFIG: any[] = [
    {
        accountId: DEVO_ACC_ID,
        name: [STAGE.DEVO],
        setupAlarms: false,
        queuesConfig: QUEUES_CONFIG[STAGE.DEVO],
        lambdasConfig: LAMBDAS_CONFIG[STAGE.DEVO],
        region: 'us-east-1',
        approvalStepConfig: {
            runIntegrationTests: false,
        },
        enableTicketing: false
    },
    {
        accountId: DEVO_ACC_ID,
        name: [STAGE.GAMMA],
        setupAlarms: false,
        queuesConfig: QUEUES_CONFIG[STAGE.DEVO],
        lambdasConfig: LAMBDAS_CONFIG[STAGE.DEVO],
        region: 'eu-west-1',
        approvalStepConfig: {
            runIntegrationTests: true,
        },
        enableTicketing: false
    },
    {
        accountId: PROD_ACC_ID,
        name: [STAGE.PROD],
        setupAlarms: true,
        queuesConfig: QUEUES_CONFIG[STAGE.PROD],
        lambdasConfig: LAMBDAS_CONFIG[STAGE.PROD],
        prod: true,
        region: 'eu-west-1',
        approvalStepConfig: {
            runIntegrationTests: false,
        },
        enableTicketing: true
    }
]
