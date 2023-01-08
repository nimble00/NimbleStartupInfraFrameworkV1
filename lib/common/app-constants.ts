import {QUEUES_CONFIG} from "./pubsub-constants";
import {LAMBDAS_CONFIG} from "./compute-constants";
import {STAGE} from "./base-constants";

export const APPLICATION_NAME = 'APP_NAME';
export const APP_ACC_ID = '367428151234';
export const DEVO_ACC_ID = '367428151234';
export const GAMMA_ACC_ID = '367428151234';
export const PROD_ACC_ID = '367428151234';

export const STAGES_CONFIG: any = {
    Devo: {
        deploymentGroups: [
            {
                accountId: DEVO_ACC_ID,
                region: 'eu-west-1',
                deploySpecificStack: true,
                approvalStepConfig: {
                    runIntegrationTests: true,
                },
                enableTicketing: false
            },
            {
                accountId: DEVO_ACC_ID,
                region: 'us-east-1',
                deploySpecificStack: true,
                approvalStepConfig: {
                    runIntegrationTests: false,
                },
                enableTicketing: false
            }
        ],
        name: [STAGE.DEVO],
        setupAlarms: false,
        queuesConfig: QUEUES_CONFIG[STAGE.DEVO],
        lambdasConfig: LAMBDAS_CONFIG[STAGE.DEVO],
    },
    Prod: {
        deploymentGroups: [
            {
                accountId: PROD_ACC_ID,
                region: 'eu-west-1',
                deploySpecificStack: true,
                approvalStepConfig: {
                    runIntegrationTests: false,
                },
                enableTicketing: true
            }
        ],
        name: [STAGE.PROD],
        setupAlarms: true,
        queuesConfig: QUEUES_CONFIG[STAGE.PROD],
        lambdasConfig: LAMBDAS_CONFIG[STAGE.PROD],
        prod: true,
    }
}
