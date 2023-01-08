import {Duration} from "aws-cdk-lib";
import {STAGE} from "./base-constants";


export const CT_WRITE_LAMBDA_NAME = 'CtWriteLambda';
export const CT_READ_LAMBDA_NAME = 'CtReadLambda';

export const LAMBDAS_CONFIG = {
    [STAGE.DEVO]: {
        [CT_READ_LAMBDA_NAME]: {
            batchSize: 2,
            maxBatchingWindow: Duration.seconds(10)
        },
        [CT_WRITE_LAMBDA_NAME]: {
            batchSize: 2,
            maxBatchingWindow: Duration.seconds(10)
        }
    },
    [STAGE.PROD]: {
        [CT_WRITE_LAMBDA_NAME]: {
            batchSize: 500,
            maxBatchingWindow: Duration.minutes(5)
        },
        [CT_READ_LAMBDA_NAME]: {
            batchSize: 25,
            maxBatchingWindow: Duration.minutes(1)
        }
    }
}