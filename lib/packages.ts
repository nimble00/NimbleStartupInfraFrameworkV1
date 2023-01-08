import {BrazilPackage} from "@amzn/pipelines";

const targetPackage: string = "GrafSagemakerCDK-1.0/mainline";
const lambdaAssetPackage: string = "GrafRealtimeStreamLambda-1.0/mainline";
const lambdaExperimentPackage: string = "GrafRealtimeExperiments-1.0/mainline";

const autoBuildPackages: string[] = [
    targetPackage,
    lambdaAssetPackage
];

export const getTargetPackage = () => BrazilPackage.fromString(targetPackage);
export const getLambdaAssetPackage = () => BrazilPackage.fromString(lambdaAssetPackage);
export const getLambdaExperimentPackage = () => BrazilPackage.fromString(lambdaExperimentPackage);
export const getAutoBuildPackages = () => autoBuildPackages.map(pkg => BrazilPackage.fromString(pkg));