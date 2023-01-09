import {Duration} from "aws-cdk-lib";
import {STAGE} from "./base-constants";

export const CLICK_THRU_EVENTS_Q_NAME = 'ClickThruEventsQueue';
export const CLICK_THRU_EVENTS_DLQ_NAME = 'ClickThruEventsQueueDLQ';
export const CLICK_THRU_EVENT_BUS_NAME = 'ClickThruEventsBus';
export const CLICK_THRU_SNS_NAME = 'ClickThruSnsTopic';


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
