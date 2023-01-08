import {DeploymentEnvironment, DeploymentStack, DogmaTagsOptions, SoftwareType} from '@amzn/pipelines';
import {App} from 'aws-cdk-lib';
import {
    BillingAlarm,
    SecureIsolatedSageMakerVpc,
    SecureTrail, SecureTrailAlarms,
    SIMTicketingAlarmAction,
    TicketSeverity, TodWorkerUser
} from '@amzn/alexa-ml-common-constructs';
import {AccountPrincipal, AnyPrincipal, Effect, PolicyDocument, PolicyStatement, Role} from "aws-cdk-lib/aws-iam";
import {
    FlowLogDestination,
    FlowLogTrafficType,
    InterfaceVpcEndpointAwsService,
    SecurityGroup
} from "aws-cdk-lib/aws-ec2";
import {CfnAssessmentTarget} from "aws-cdk-lib/aws-inspector";
import ec2 = require('aws-cdk-lib/aws-ec2');
import {CW_DASHBOARD_ROLE_NAME, CW_WIKI_AWS_ACCOUNT} from "./monitoring/constants";
import {team} from "./common/constants";
import {isExperiment} from "./common/utils";
import {TodWorker} from "@amzn/alexa-ml-common-constructs/lib/configuration";

// If you want to add parameters for your CDK Stack, you can toss them in here
export interface VpcStackProps {
    readonly env: DeploymentEnvironment;
    readonly stackName?: string;
    readonly stage?: string;
    /**
     * Stack tags that will be applied to all the taggable resources and the stack itself.
     *
     * @default {}
     */
    readonly tags?: {
        [key: string]: string;
    };
    /**
     * Optional Dogma tags. Read `DogmaTags` for mode details or
     * this wiki https://w.amazon.com/bin/view/ReleaseExcellence/Team/Designs/PDGTargetSupport/Tags/
     */
    readonly dogmaTags?: DogmaTagsOptions;
    todWorker?: TodWorker;
}

export class VpcStack extends DeploymentStack {
    public readonly secureVpc: SecureIsolatedSageMakerVpc;
    public readonly modelSecurityGroup: SecurityGroup;
    public readonly todWorkerUser: TodWorkerUser;

    constructor(parent: App, name: string, props: VpcStackProps) {
        super(parent, name, {
            softwareType: SoftwareType.INFRASTRUCTURE,
            ...props
        });
        this.secureVpc = new SecureIsolatedSageMakerVpc(this, 'Vpc');

        const inspectorTarget = new CfnAssessmentTarget(this, `GrafCfnAssessmentTarget-${props.stage}-${this.region}`);

        if (props.todWorker) {
            this.todWorkerUser = new TodWorkerUser(this, 'TodWorker', {
                todWorker: props.todWorker,
            });
        }

        if (!isExperiment(props.env.region)) {
            new Role(this, CW_DASHBOARD_ROLE_NAME, {
                roleName: CW_DASHBOARD_ROLE_NAME,
                description: "Role used for embedded wiki dashboards",
                assumedBy: new AccountPrincipal(CW_WIKI_AWS_ACCOUNT), // internal embedded CW dashboards account
                inlinePolicies: {
                    CloudWatchAccess: new PolicyDocument({
                        statements: [new PolicyStatement({
                            effect: Effect.ALLOW,
                            resources: ["*"],
                            actions: [
                                "cloudwatch:DescribeAlarms",
                                "cloudwatch:GetDashboard",
                                "cloudwatch:GetInsightRuleReport",
                                "cloudwatch:GetMetricData",
                                "cloudwatch:ListDashboards",
                                "logs:FilterLogEvents"
                            ]
                        })]
                    })
                }
            });
        }

        this.secureVpc.vpc.addInterfaceEndpoint('Sts', {
            service: InterfaceVpcEndpointAwsService.STS,
            open: true
        });

        this.secureVpc.vpc.addInterfaceEndpoint('Sns', {
            service: InterfaceVpcEndpointAwsService.SNS,
            open: true
        });

        this.secureVpc.vpc.addInterfaceEndpoint('Sqs', {
            service: InterfaceVpcEndpointAwsService.SQS,
            open: true
        });

        this.secureVpc.vpc.addFlowLog(`GrafFlowLogS3-${props.stage}-${this.region}`, {
            destination: FlowLogDestination.toCloudWatchLogs(),
            trafficType: FlowLogTrafficType.ALL
        });

        this.modelSecurityGroup = new SecurityGroup(this, 'ModelSecurityGroupCustom', {
            vpc: this.secureVpc.vpc,
            allowAllOutbound: true
        });

        const privateSubnet0 = new ec2.PrivateSubnet(this, 'NeptunePrivateSubnet0', {
            availabilityZone: this.secureVpc.vpc.availabilityZones[0],
            cidrBlock: "10.0.192.0/24",
            vpcId: this.secureVpc.vpc.vpcId
        });

        const privateSubnet1 = new ec2.PrivateSubnet(this, 'NeptunePrivateSubnet1', {
            availabilityZone: this.secureVpc.vpc.availabilityZones[1],
            cidrBlock: "10.0.200.0/24",
            vpcId: this.secureVpc.vpc.vpcId
        });

        this.secureVpc.vpc.privateSubnets.push(privateSubnet0, privateSubnet1);

        this.secureVpc.vpc.addGatewayEndpoint('s3Endpoint', {
            service: ec2.GatewayVpcEndpointAwsService.S3,
            subnets: [
                { subnetType: ec2.SubnetType.PRIVATE }
            ]
        });

        const dynamoDbEndpoint = this.secureVpc.vpc.addGatewayEndpoint('DynamoDbEndpoint', {
            service: ec2.GatewayVpcEndpointAwsService.DYNAMODB
        });

        dynamoDbEndpoint.addToPolicy(
            new PolicyStatement({
                principals: [new AnyPrincipal()],
                actions: [
                    "dynamodb:BatchGet*",
                    "dynamodb:GetItem",
                    "dynamodb:PutItem",
                    "dynamodb:PartiQLUpdate"
                ],
                resources: ['*'],
                effect: Effect.ALLOW
            })
        );

    }
}