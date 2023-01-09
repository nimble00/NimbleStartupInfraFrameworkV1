export function isExperiment(region: any) {
    return region == 'us-east-1' || region == 'bla-bla';
}

export function joinStrings(resourceId: string, dgSuffix: string) {
    return `${resourceId}-${dgSuffix}`;
}

