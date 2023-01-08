import {Duration} from "aws-cdk-lib";
import {STAGE} from "./base-constants";

export const CLICK_THRU_EVENTS_Q_NAME = 'IngestClickThruEventsQueue';
export const CLICK_THRU_EVENTS_DLQ_NAME = 'InferenceClickThruEventsQueueDLQ';

export const QUEUES_CONFIG = {
    [STAGE.DEVO]: {
        [CLICK_THRU_EVENTS_Q_NAME]: {
            deliveryDelay: Duration.seconds(0)
        }
    },
    [STAGE.PROD]: {
        [CLICK_THRU_EVENTS_Q_NAME]: {
            deliveryDelay: Duration.minutes(15)
        }
    }
}
