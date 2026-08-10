/**
 * The Redshift console, as data (M10b2) — pure, no `vscode` and no AWS SDK
 * import. Everything the console shows under "Properties", "Parameters" and
 * "Network and security" comes from the public Describe and Get calls; this
 * module turns those responses into the rows a panel renders, and is where one
 * judgement worth making lives: **which values differ from the engine default**.
 * The console hides that, and it is the first thing anyone diagnosing a
 * warehouse wants to see.
 *
 * The SDK response types are declared structurally (every field optional, as
 * the SDK has them) so the mappers can be fed plain objects in tests without
 * dragging the SDK into the unit suite.
 */

export type ClusterSectionId =
  | 'properties' | 'parameters' | 'network'
  | 'snapshots' | 'maintenance' | 'logging' | 'scheduled' | 'limits' | 'events' | 'reserved';

export interface InfoRow {
  label: string;
  value: string;
  /** Differs from the engine default — the reason this view exists. */
  nonDefault?: boolean;
  /** Something the reader should look at twice (public, unencrypted, pending). */
  warn?: boolean;
  /** Extra context rendered under the value. */
  note?: string;
}

export interface InfoGroup {
  title: string;
  rows: InfoRow[];
}

export interface SectionModel {
  id: ClusterSectionId;
  title: string;
  groups: InfoGroup[];
  /** Caveat about what the data can and cannot say. */
  note?: string;
}

export const CLUSTER_SECTIONS: { id: ClusterSectionId; title: string; icon: string; detail: string }[] = [
  { id: 'properties', title: 'Properties', icon: 'server', detail: 'Status, version, endpoint, size, database and IAM roles.' },
  { id: 'parameters', title: 'Parameters', icon: 'settings-gear', detail: 'Parameter group values, with everything non-default first.' },
  { id: 'network', title: 'Network & security', icon: 'shield', detail: 'VPC, subnets, security groups, public access and encryption.' },
  { id: 'snapshots', title: 'Snapshots', icon: 'save', detail: 'Manual and automated backups, retention and schedules.' },
  { id: 'maintenance', title: 'Maintenance', icon: 'tools', detail: 'Window, track, version and anything deferred or pending.' },
  { id: 'logging', title: 'Logging & audit', icon: 'output', detail: 'Where audit logs go, which ones, and whether delivery works.' },
  { id: 'scheduled', title: 'Scheduled actions', icon: 'calendar', detail: 'Pause, resume and resize actions somebody scheduled.' },
  { id: 'limits', title: 'Usage limits', icon: 'law', detail: 'Caps on RPU, concurrency scaling and Spectrum, and what they do.' },
  { id: 'events', title: 'Events', icon: 'megaphone', detail: 'What AWS did to this warehouse in the last 14 days.' },
  { id: 'reserved', title: 'Reservations', icon: 'credit-card', detail: 'Reserved nodes or RPU commitments versus on-demand.' },
];

// ---------------------------------------------------------------------------
// SDK-shaped inputs
// ---------------------------------------------------------------------------

export interface ProvisionedCluster {
  ClusterIdentifier?: string;
  ClusterStatus?: string;
  ClusterAvailabilityStatus?: string;
  NodeType?: string;
  NumberOfNodes?: number;
  ClusterVersion?: string;
  ClusterRevisionNumber?: string;
  DBName?: string;
  MasterUsername?: string;
  Endpoint?: { Address?: string; Port?: number };
  AvailabilityZone?: string;
  AvailabilityZoneRelocationStatus?: string;
  MultiAZ?: string;
  VpcId?: string;
  ClusterSubnetGroupName?: string;
  VpcSecurityGroups?: { VpcSecurityGroupId?: string; Status?: string }[];
  PubliclyAccessible?: boolean;
  EnhancedVpcRouting?: boolean;
  Encrypted?: boolean;
  KmsKeyId?: string;
  ClusterParameterGroups?: { ParameterGroupName?: string; ParameterApplyStatus?: string }[];
  IamRoles?: { IamRoleArn?: string; ApplyStatus?: string }[];
  DefaultIamRoleArn?: string;
  ClusterCreateTime?: Date | string;
  PreferredMaintenanceWindow?: string;
  MaintenanceTrackName?: string;
  AllowVersionUpgrade?: boolean;
  DeferredMaintenanceWindows?: {
    DeferMaintenanceIdentifier?: string;
    DeferMaintenanceStartTime?: Date | string;
    DeferMaintenanceEndTime?: Date | string;
  }[];
  ClusterNamespaceArn?: string;
  TotalStorageCapacityInMegaBytes?: number;
  PendingModifiedValues?: Record<string, unknown>;
}

export interface ClusterParameter {
  ParameterName?: string;
  ParameterValue?: string;
  /** 'engine-default' or 'user' — the authoritative non-default signal. */
  Source?: string;
  Description?: string;
  ApplyType?: string;
  IsModifiable?: boolean;
}

export interface SubnetGroup {
  ClusterSubnetGroupName?: string;
  VpcId?: string;
  Description?: string;
  SubnetGroupStatus?: string;
  Subnets?: { SubnetIdentifier?: string; SubnetAvailabilityZone?: { Name?: string }; SubnetStatus?: string }[];
}

export interface ServerlessWorkgroup {
  workgroupName?: string;
  workgroupArn?: string;
  namespaceName?: string;
  status?: string;
  baseCapacity?: number;
  maxCapacity?: number;
  pricePerformanceTarget?: { status?: string; level?: number };
  endpoint?: { address?: string; port?: number };
  enhancedVpcRouting?: boolean;
  publiclyAccessible?: boolean;
  ipAddressType?: string;
  subnetIds?: string[];
  securityGroupIds?: string[];
  configParameters?: { parameterKey?: string; parameterValue?: string }[];
  workgroupVersion?: string;
  patchVersion?: string;
  trackName?: string;
  creationDate?: Date | string;
}

export interface ServerlessNamespace {
  namespaceName?: string;
  namespaceArn?: string;
  namespaceId?: string;
  status?: string;
  dbName?: string;
  adminUsername?: string;
  adminPasswordSecretArn?: string;
  kmsKeyId?: string;
  defaultIamRoleArn?: string;
  iamRoles?: string[];
  logExports?: string[];
  creationDate?: Date | string;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Absent is absent: '—', never a silent empty cell or a fabricated default. */
export function text(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null || value === '') {
    return '—';
  }
  return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
}

export function isoDate(value: Date | string | undefined): string {
  if (value === undefined) {
    return '—';
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/**
 * Serverless does not return `iamRoles` as bare ARNs. It returns strings shaped
 * like `IamRole(applyStatus=in-sync, iamRoleArn=arn:aws:iam::…:role/x)` — a
 * stringified struct. Verified against real AWS on 2026-07-27; before that the
 * role rendered as `x)`, with the stray parenthesis.
 */
export function parseServerlessIamRole(raw: string): { arn: string; status?: string } {
  const arn = /iamRoleArn=([^,)\s]+)/.exec(raw)?.[1];
  if (arn === undefined) {
    return { arn: raw.trim() }; // already a plain ARN, or a shape we don't know
  }
  return { arn, status: /applyStatus=([^,)\s]+)/.exec(raw)?.[1] };
}

/** ARNs and KMS keys are long and the tail is the identifying part. */
export function shortArn(arn: string | undefined): string {
  if (arn === undefined || arn === '') {
    return '—';
  }
  const slash = arn.lastIndexOf('/');
  const colon = arn.lastIndexOf(':');
  const cut = Math.max(slash, colon);
  return cut > 0 && cut < arn.length - 1 ? arn.slice(cut + 1) : arn;
}

function megabytes(mb: number | undefined): string {
  if (mb === undefined) {
    return '—';
  }
  return mb >= 1024 * 1024 ? `${(mb / 1024 / 1024).toFixed(1)} TB` : mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

// ---------------------------------------------------------------------------
// Provisioned
// ---------------------------------------------------------------------------

export function provisionedProperties(c: ProvisionedCluster): SectionModel {
  const pending = Object.keys(c.PendingModifiedValues ?? {});
  const nodes = c.NumberOfNodes === undefined ? '—' : `${c.NumberOfNodes} × ${text(c.NodeType)}`;
  const endpoint = c.Endpoint?.Address === undefined ? '—' : `${c.Endpoint.Address}:${text(c.Endpoint.Port)}`;
  const roles = (c.IamRoles ?? []).map((r) => ({
    label: shortArn(r.IamRoleArn),
    value: text(r.ApplyStatus),
    note: r.IamRoleArn,
  }));

  return {
    id: 'properties',
    title: `Cluster ${text(c.ClusterIdentifier)}`,
    groups: [
      {
        title: 'Status',
        rows: [
          { label: 'Status', value: text(c.ClusterStatus), warn: c.ClusterStatus !== 'available' },
          { label: 'Availability', value: text(c.ClusterAvailabilityStatus) },
          {
            label: 'Pending changes',
            value: pending.length === 0 ? 'None' : pending.join(', '),
            warn: pending.length > 0,
            note: pending.length > 0 ? 'Applied at the next maintenance window or reboot.' : undefined,
          },
          { label: 'Created', value: isoDate(c.ClusterCreateTime) },
        ],
      },
      {
        title: 'Compute',
        rows: [
          { label: 'Nodes', value: nodes },
          { label: 'Version', value: `${text(c.ClusterVersion)}${c.ClusterRevisionNumber === undefined ? '' : ` (rev ${c.ClusterRevisionNumber})`}` },
          { label: 'Maintenance track', value: text(c.MaintenanceTrackName) },
          { label: 'Maintenance window', value: text(c.PreferredMaintenanceWindow) },
          { label: 'Auto version upgrade', value: text(c.AllowVersionUpgrade) },
          { label: 'Managed storage', value: megabytes(c.TotalStorageCapacityInMegaBytes) },
        ],
      },
      {
        title: 'Database',
        rows: [
          { label: 'Endpoint', value: endpoint },
          { label: 'Database name', value: text(c.DBName) },
          { label: 'Admin user', value: text(c.MasterUsername) },
          { label: 'Availability zone', value: text(c.AvailabilityZone) },
          { label: 'AZ relocation', value: text(c.AvailabilityZoneRelocationStatus) },
          { label: 'Multi-AZ', value: text(c.MultiAZ) },
          { label: 'Namespace ARN', value: text(c.ClusterNamespaceArn) },
        ],
      },
      {
        title: 'IAM roles',
        rows: roles.length === 0 ? [{ label: 'Attached roles', value: 'None' }] : roles,
      },
    ],
  };
}



// ---------------------------------------------------------------------------
// Serverless
// ---------------------------------------------------------------------------


export function serverlessProperties(w: ServerlessWorkgroup, ns: ServerlessNamespace | undefined): SectionModel {
  const endpoint = w.endpoint?.address === undefined ? '—' : `${w.endpoint.address}:${text(w.endpoint.port)}`;
  const capacity = w.baseCapacity === undefined
    ? '—'
    : `${w.baseCapacity} RPU base${w.maxCapacity === undefined ? '' : ` · ${w.maxCapacity} RPU max`}`;
  const roles = (ns?.iamRoles ?? []).map((raw) => {
    const role = parseServerlessIamRole(raw);
    return { label: shortArn(role.arn), value: role.status ?? 'attached', note: role.arn };
  });

  return {
    id: 'properties',
    title: `Workgroup ${text(w.workgroupName)}`,
    groups: [
      {
        title: 'Status',
        rows: [
          { label: 'Workgroup status', value: text(w.status), warn: w.status !== undefined && w.status.toUpperCase() !== 'AVAILABLE' },
          { label: 'Namespace', value: text(w.namespaceName) },
          { label: 'Namespace status', value: text(ns?.status) },
          { label: 'Created', value: isoDate(w.creationDate) },
        ],
      },
      {
        title: 'Compute',
        rows: [
          { label: 'Capacity', value: capacity },
          {
            label: 'Price-performance target',
            value: w.pricePerformanceTarget?.status === 'ENABLED' ? `level ${text(w.pricePerformanceTarget.level)}` : text(w.pricePerformanceTarget?.status),
            note: 'AI-driven scaling target: higher means AWS spends more RPU to go faster.',
          },
          { label: 'Version', value: `${text(w.workgroupVersion)}${w.patchVersion === undefined ? '' : ` (patch ${w.patchVersion})`}` },
          { label: 'Track', value: text(w.trackName) },
        ],
      },
      {
        title: 'Database',
        rows: [
          { label: 'Endpoint', value: endpoint },
          { label: 'Database name', value: text(ns?.dbName) },
          { label: 'Admin user', value: text(ns?.adminUsername) },
          {
            label: 'Admin credentials',
            value: ns?.adminPasswordSecretArn === undefined ? 'Managed by you' : 'Managed in Secrets Manager',
            note: ns?.adminPasswordSecretArn,
          },
          { label: 'Namespace ARN', value: text(ns?.namespaceArn) },
        ],
      },
      { title: 'IAM roles', rows: roles.length === 0 ? [{ label: 'Attached roles', value: 'None' }] : roles },
    ],
  };
}



