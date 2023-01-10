import {App, Environment, Stack} from 'aws-cdk-lib';
import {AnyPrincipal, Effect, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {
    FlowLogDestination,
    FlowLogTrafficType, GatewayVpcEndpointAwsService,
    InterfaceVpcEndpointAwsService, PrivateSubnet,
    SubnetType, Vpc
} from "aws-cdk-lib/aws-ec2";
import {joinStrings} from "../common/utils";
import {Construct} from "constructs";

// If you want to add parameters for your CDK Stack, you can toss them in here
export interface VpcStackProps {
    readonly app: App;
    readonly env: Environment;
    readonly stackName?: string;
    readonly suffix: string;
    readonly stage?: string;
    /**
     * Stack tags that will be applied to all the taggable resources and the stack itself.
     *
     * @default {}
     */
    readonly tags?: {
        [key: string]: string;
    };
}

export class VpcStack extends Stack {
    public readonly secureVpc: Vpc;

    constructor(parent: Construct, name: string, props: VpcStackProps) {
        super(parent, name, {
            ...props
        });
        this.secureVpc = new Vpc(this, 'Vpc');

        this.secureVpc.addInterfaceEndpoint('Sts', {
            service: InterfaceVpcEndpointAwsService.STS,
            open: true
        });

        this.secureVpc.addInterfaceEndpoint('Sns', {
            service: InterfaceVpcEndpointAwsService.SNS,
            open: true
        });

        this.secureVpc.addInterfaceEndpoint('Sqs', {
            service: InterfaceVpcEndpointAwsService.SQS,
            open: true
        });

        this.secureVpc.addFlowLog(joinStrings(`FlowLogS3`, props.suffix), {
            destination: FlowLogDestination.toCloudWatchLogs(),
            trafficType: FlowLogTrafficType.ALL
        });

        const privateSubnet0 = new PrivateSubnet(this, joinStrings('NeptunePrivateSubnet0', props.suffix), {
            availabilityZone: this.secureVpc.availabilityZones[0],
            cidrBlock: "10.0.192.0/24",
            vpcId: this.secureVpc.vpcId
        });

        const privateSubnet1 = new PrivateSubnet(this, joinStrings('NeptunePrivateSubnet1', props.suffix), {
            availabilityZone: this.secureVpc.availabilityZones[1],
            cidrBlock: "10.0.200.0/24",
            vpcId: this.secureVpc.vpcId
        });

        this.secureVpc.privateSubnets.push(privateSubnet0, privateSubnet1);

        this.secureVpc.addGatewayEndpoint(joinStrings('s3Endpoint', props.suffix), {
            service: GatewayVpcEndpointAwsService.S3,
            subnets: [
                {subnetType: SubnetType.PRIVATE_WITH_EGRESS}
            ]
        });

        const dynamoDbEndpoint = this.secureVpc.addGatewayEndpoint(joinStrings('DynamoDbEndpoint', props.suffix), {
            service: GatewayVpcEndpointAwsService.DYNAMODB
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