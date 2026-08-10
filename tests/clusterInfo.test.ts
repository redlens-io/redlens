import { describe, expect, it } from 'vitest';
import {
  CLUSTER_SECTIONS, isoDate, parseServerlessIamRole, provisionedProperties,
  serverlessProperties, shortArn, text,
  type InfoRow, type ProvisionedCluster, type SectionModel,
} from '../src/aws/clusterInfo';
import { DEMO_NAMESPACE, DEMO_WORKGROUP } from '../src/aws/clusterFixtures';
import { clusterHtml } from '../src/cluster/clusterHtml';

const CLUSTER: ProvisionedCluster = {
  ClusterIdentifier: 'redlens-dw',
  ClusterStatus: 'available',
  ClusterAvailabilityStatus: 'Available',
  NodeType: 'ra3.xlplus',
  NumberOfNodes: 4,
  ClusterVersion: '1.0',
  ClusterRevisionNumber: '92839',
  DBName: 'dev',
  MasterUsername: 'awsuser',
  Endpoint: { Address: 'redlens-dw.abc123.us-east-1.redshift.amazonaws.com', Port: 5439 },
  AvailabilityZone: 'us-east-1a',
  VpcId: 'vpc-0123456789abcdef0',
  ClusterSubnetGroupName: 'redlens-subnets',
  VpcSecurityGroups: [{ VpcSecurityGroupId: 'sg-0abc', Status: 'active' }],
  PubliclyAccessible: false,
  EnhancedVpcRouting: true,
  Encrypted: true,
  KmsKeyId: 'arn:aws:kms:us-east-1:123456789012:key/2f9c8d41-73ab-4e15-9b6c-0d8a41f5e2b7',
  ClusterParameterGroups: [{ ParameterGroupName: 'redlens-params', ParameterApplyStatus: 'in-sync' }],
  IamRoles: [{ IamRoleArn: 'arn:aws:iam::123456789012:role/RedLensSpectrum', ApplyStatus: 'in-sync' }],
  ClusterCreateTime: '2026-02-01T08:00:00Z',
  PreferredMaintenanceWindow: 'sun:07:30-sun:08:00',
  MaintenanceTrackName: 'current',
  AllowVersionUpgrade: true,
  TotalStorageCapacityInMegaBytes: 4_194_304,
};

function rowsOf(section: SectionModel): InfoRow[] {
  return section.groups.flatMap((g) => g.rows);
}
function find(section: SectionModel, label: string): InfoRow | undefined {
  return rowsOf(section).find((r) => r.label === label);
}

describe('formatting helpers', () => {
  it('renders absence as an em dash instead of an empty cell', () => {
    expect(text(undefined)).toBe('—');
    expect(text('')).toBe('—');
    expect(text(null)).toBe('—');
    expect(text(0)).toBe('0');
    expect(text(false)).toBe('No');
    expect(text(true)).toBe('Yes');
  });

  it('keeps the identifying tail of an ARN', () => {
    expect(shortArn('arn:aws:iam::123456789012:role/RedLensSpectrum')).toBe('RedLensSpectrum');
    expect(shortArn('arn:aws:kms:us-east-1:1:key/abc-def')).toBe('abc-def');
    expect(shortArn(undefined)).toBe('—');
    expect(shortArn('')).toBe('—');
  });

  it('formats dates as readable UTC and passes through what it cannot parse', () => {
    expect(isoDate('2026-02-01T08:00:00Z')).toBe('2026-02-01 08:00:00 UTC');
    expect(isoDate(new Date('2026-02-01T08:00:00Z'))).toBe('2026-02-01 08:00:00 UTC');
    expect(isoDate(undefined)).toBe('—');
    expect(isoDate('not a date')).toBe('not a date');
  });
});

describe('provisioned properties', () => {
  it('answers the questions the console front page answers', () => {
    const s = provisionedProperties(CLUSTER);
    expect(s.title).toContain('redlens-dw');
    expect(find(s, 'Nodes')?.value).toBe('4 × ra3.xlplus');
    expect(find(s, 'Endpoint')?.value).toBe('redlens-dw.abc123.us-east-1.redshift.amazonaws.com:5439');
    expect(find(s, 'Version')?.value).toBe('1.0 (rev 92839)');
    expect(find(s, 'Managed storage')?.value).toBe('4.0 TB');
    expect(find(s, 'Created')?.value).toBe('2026-02-01 08:00:00 UTC');
  });

  it('flags a status that is not "available"', () => {
    expect(find(provisionedProperties(CLUSTER), 'Status')?.warn).toBe(false);
    expect(find(provisionedProperties({ ...CLUSTER, ClusterStatus: 'modifying' }), 'Status')?.warn).toBe(true);
  });

  it('surfaces pending modifications, which explain surprises later', () => {
    const none = find(provisionedProperties(CLUSTER), 'Pending changes');
    expect(none?.value).toBe('None');
    expect(none?.warn).toBe(false);
    const pending = find(provisionedProperties({ ...CLUSTER, PendingModifiedValues: { NodeType: 'ra3.4xlarge' } }), 'Pending changes');
    expect(pending?.value).toBe('NodeType');
    expect(pending?.warn).toBe(true);
  });

  it('lists IAM roles by their short name and says so when there are none', () => {
    expect(find(provisionedProperties(CLUSTER), 'RedLensSpectrum')?.value).toBe('in-sync');
    expect(find(provisionedProperties({ ...CLUSTER, IamRoles: [] }), 'Attached roles')?.value).toBe('None');
  });

  it('parses the stringified struct Serverless returns for iamRoles', () => {
    // The SHAPE here is a real observation from a live Serverless workgroup:
    // iamRoles comes back as a stringified struct, NOT as a bare ARN, and before
    // this it rendered as "redlens-b-copy-role)" with the stray parenthesis.
    // The account id is a placeholder — the real one was captured verbatim when
    // this test was written, and this file is about to be public.
    const parsed = parseServerlessIamRole(
      'IamRole(applyStatus=in-sync, iamRoleArn=arn:aws:iam::123456789012:role/redlens-b-copy-role)',
    );
    expect(parsed).toEqual({ arn: 'arn:aws:iam::123456789012:role/redlens-b-copy-role', status: 'in-sync' });
    expect(shortArn(parsed.arn)).toBe('redlens-b-copy-role');
  });

  it('passes a plain ARN through, in case the shape ever changes', () => {
    expect(parseServerlessIamRole('arn:aws:iam::1:role/plain')).toEqual({ arn: 'arn:aws:iam::1:role/plain' });
  });

  it('renders the serverless role with its apply status, not a mangled label', () => {
    const s = serverlessProperties(DEMO_WORKGROUP, {
      ...DEMO_NAMESPACE,
      iamRoles: ['IamRole(applyStatus=in-sync, iamRoleArn=arn:aws:iam::1:role/RedLensSpectrum)'],
    });
    const row = find(s, 'RedLensSpectrum');
    expect(row?.value).toBe('in-sync');
    expect(row?.note).toBe('arn:aws:iam::1:role/RedLensSpectrum');
  });

  it('never invents a value for a field AWS did not return', () => {
    const s = provisionedProperties({ ClusterIdentifier: 'bare' });
    expect(find(s, 'Nodes')?.value).toBe('—');
    expect(find(s, 'Endpoint')?.value).toBe('—');
    expect(find(s, 'Admin user')?.value).toBe('—');
  });
});

describe('serverless properties', () => {
  it('reports capacity, price-performance target and the managed admin secret', () => {
    const s = serverlessProperties(DEMO_WORKGROUP, DEMO_NAMESPACE);
    expect(find(s, 'Capacity')?.value).toBe('32 RPU base · 128 RPU max');
    expect(find(s, 'Price-performance target')?.value).toBe('level 50');
    expect(find(s, 'Admin credentials')?.value).toBe('Managed in Secrets Manager');
    expect(find(s, 'Database name')?.value).toBe('dev');
  });

  it('still renders when the namespace could not be read', () => {
    const s = serverlessProperties(DEMO_WORKGROUP, undefined);
    expect(find(s, 'Database name')?.value).toBe('—');
    expect(find(s, 'Attached roles')?.value).toBe('None');
    expect(find(s, 'Capacity')?.value).toBe('32 RPU base · 128 RPU max');
  });

  it('flags a workgroup that is not available', () => {
    expect(find(serverlessProperties(DEMO_WORKGROUP, DEMO_NAMESPACE), 'Workgroup status')?.warn).toBe(false);
    expect(find(serverlessProperties({ ...DEMO_WORKGROUP, status: 'MODIFYING' }, DEMO_NAMESPACE), 'Workgroup status')?.warn).toBe(true);
  });
});

describe('section catalog', () => {
  // The exact section list is asserted in clusterOps.test.ts, which owns the
  // sections added in b3; here we only guard the shape of an entry.
  it('describes each section in one line for the tree tooltip', () => {
    expect(CLUSTER_SECTIONS.map((s) => s.id)).toEqual(expect.arrayContaining(['properties', 'parameters', 'network']));
    for (const s of CLUSTER_SECTIONS) {
      expect(s.detail.length).toBeGreaterThan(20);
      expect(s.detail.endsWith('.')).toBe(true);
      expect(s.icon.length).toBeGreaterThan(0);
      expect(s.title.length).toBeGreaterThan(0);
    }
  });
});

describe('section catalog after b3', () => {
  it('covers every section the service can answer', () => {
    expect(CLUSTER_SECTIONS.map((s) => s.id)).toEqual([
      'properties', 'parameters', 'network', 'snapshots', 'maintenance',
      'logging', 'scheduled', 'limits', 'events', 'reserved',
    ]);
  });

  it('describes each one in a single readable line', () => {
    for (const s of CLUSTER_SECTIONS) {
      expect(s.detail.length, s.id).toBeGreaterThan(20);
      expect(s.detail.length, s.id).toBeLessThan(90);
      expect(s.detail.endsWith('.'), s.id).toBe(true);
    }
  });
});

describe('cluster panel html', () => {
  const html = (section: SectionModel, source: 'live' | 'demo' = 'demo') =>
    clusterHtml({ section, targetLabel: 'Serverless · redlens-demo · us-east-1', source });

  it('renders a read-only page with no scripts at all', () => {
    const out = html(serverlessProperties(DEMO_WORKGROUP, DEMO_NAMESPACE));
    expect(out).toContain("default-src 'none'");
    expect(out).not.toContain('<script');
    expect(out).toContain('redlens-demo');
  });
});

