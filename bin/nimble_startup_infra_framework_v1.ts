#!/usr/bin/env node
import 'source-map-support/register';
import {MyPipelineStack} from "../lib/pipeline";
import {APP_ACC_ID} from "../lib/common/app-constants";
import {App} from "aws-cdk-lib";

const app = new App();
new MyPipelineStack(app, 'MyPipelineStack', {
    /* If you don't specify 'env', this stack will be environment-agnostic.
     * Account/Region-dependent features and context lookups will not work,
     * but a single synthesized template can be deployed anywhere. */

    /* Uncomment the next line to specialize this stack for the AWS Account
     * and Region that are implied by the current CLI configuration. */
    // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

    /* Uncomment the next line if you know exactly what Account and Region you
     * want to deploy the stack to. */
    env: { account: APP_ACC_ID, region: 'eu-west-1' },
    app: app
    /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});

app.synth();
