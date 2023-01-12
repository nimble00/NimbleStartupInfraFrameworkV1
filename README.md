# Welcome to the NimbleStartupInfraFrameworkV1 TypeScript project

## Why?
This package is the "Code" that's known in tech-world as **Infrastructure as Code**.
It carries a easily and highly extensible templates to setup following infra - 
1. SQS, SNS, EventBus+Rule
2. Lambda, Integration Tests
3. DynamoDb Table
4. Cloudwatch Metrics, Alarms and Dashboard
5. VPC, Endpoints, Subnets, and SecurityGroups

Template code is organised and written so that user remains cognizant of **security, testing, infra-costs, scalability, and monitoring**.


You may use this project for CDK development with TypeScript.

## How / Usage
1. Checkout this code locally
2. Add your AWS account(s) to the `lib/common/app-constants.ts` file  
3. Configure aws credentials to the `App` account using `aws configure`
4. Run `npm install && npm run build && npx cdk synth && npx cdk bootstrap` (bootstrap only needed first time or when adding a new AWS Account)
5. Run `npx cdk deploy "MyPipelineStack/MyPipelineAppStage-Devo-us-east-1/*"`

The `cdk.json` file tells the CDK Toolkit how to execute your app.


## Recommended / necessary readings
1. https://aws.amazon.com/getting-started/guides/setup-environment/
2. https://docs.aws.amazon.com/cli/latest/userguide/getting-started-version.html
3. https://docs.aws.amazon.com/cdk/v2/guide/cdk_pipeline.html


## Other Useful Commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `cdk deploy`      deploy this stack to your default AWS account/region
* `cdk diff`        compare deployed stack with current state
* `cdk synth`       emits the synthesized CloudFormation template
