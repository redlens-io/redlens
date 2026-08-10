/**
 * Console fixtures for demo mode (M10b2). Deterministic, and deliberately not
 * pristine: the demo workgroup has a couple of parameters moved off their
 * engine default and public access left on, because a Cluster view that only
 * ever shows a perfect warehouse teaches nobody what it is for.
 *
 * The demo warehouse is Serverless, matching the CloudWatch demo target.
 */
import type { ServerlessNamespace, ServerlessWorkgroup } from './clusterInfo';

export const DEMO_WORKGROUP: ServerlessWorkgroup = {
  workgroupName: 'redlens-demo',
  workgroupArn: 'arn:aws:redshift-serverless:us-east-1:123456789012:workgroup/redlens-demo',
  namespaceName: 'redlens-demo',
  status: 'AVAILABLE',
  baseCapacity: 32,
  maxCapacity: 128,
  pricePerformanceTarget: { status: 'ENABLED', level: 50 },
  endpoint: { address: 'redlens-demo.123456789012.us-east-1.redshift-serverless.amazonaws.com', port: 5439 },
  enhancedVpcRouting: false,
  publiclyAccessible: true,
  ipAddressType: 'ipv4',
  subnetIds: ['subnet-0a1b2c3d4e5f60718', 'subnet-0a1b2c3d4e5f60719', 'subnet-0a1b2c3d4e5f6071a'],
  securityGroupIds: ['sg-0f1e2d3c4b5a69788'],
  configParameters: [
    { parameterKey: 'auto_mv', parameterValue: 'true' },
    { parameterKey: 'datestyle', parameterValue: 'ISO, MDY' },
    { parameterKey: 'enable_case_sensitive_identifier', parameterValue: 'false' },
    { parameterKey: 'enable_user_activity_logging', parameterValue: 'true' },
    { parameterKey: 'query_group', parameterValue: 'default' },
    { parameterKey: 'search_path', parameterValue: '$user, public' },
    // Two deliberate deviations from the REAL engine defaults (which were
    // corrected against a live workgroup in Fase B) — the point of the section.
    { parameterKey: 'require_ssl', parameterValue: 'false' },
    { parameterKey: 'max_query_execution_time', parameterValue: '3600' },
  ],
  workgroupVersion: '1.0.0',
  patchVersion: '188',
  trackName: 'current',
  creationDate: '2026-01-15T10:22:41Z',
};

export const DEMO_NAMESPACE: ServerlessNamespace = {
  namespaceName: 'redlens-demo',
  namespaceArn: 'arn:aws:redshift-serverless:us-east-1:123456789012:namespace/8f2a1c30-6b47-4d9e-9a10-2c5f7e0b1d42',
  namespaceId: '8f2a1c30-6b47-4d9e-9a10-2c5f7e0b1d42',
  status: 'AVAILABLE',
  dbName: 'dev',
  adminUsername: 'awsuser',
  adminPasswordSecretArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:redshift!redlens-demo-admin-AbCdEf',
  kmsKeyId: 'arn:aws:kms:us-east-1:123456789012:key/2f9c8d41-73ab-4e15-9b6c-0d8a41f5e2b7',
  defaultIamRoleArn: 'arn:aws:iam::123456789012:role/RedLensDemoSpectrumRole',
  iamRoles: [
    'arn:aws:iam::123456789012:role/RedLensDemoSpectrumRole',
    'arn:aws:iam::123456789012:role/RedLensDemoCopyFromS3',
  ],
  logExports: ['userlog', 'connectionlog'],
  creationDate: '2026-01-15T10:20:03Z',
};
