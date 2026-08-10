/**
 * Connection profiles live in settings (`redlens.connections`) WITHOUT
 * secrets; passwords go to vscode SecretStorage under a stable key derived
 * from the profile id (vscode-mssql pattern, PLAN §5).
 */
export type ProfileKind = 'direct' | 'compat' | 'demo' | 'data-api' | 'direct+ssh';

/** Generic local-Postgres defaults for compat mode. Must point at loopback, not
 * any private/author-specific host (UXD-010). Lives here (vscode-free) so it is
 * unit-testable. */
export const COMPAT_DEFAULTS = {
  host: '127.0.0.1', port: 5432, database: 'postgres', username: 'postgres', ssl: false,
} as const;

export interface SshOptions {
  bastionHost: string;
  bastionPort: number;
  username: string;
  privateKeyPath?: string;
}

export interface DataApiOptions {
  region: string;
  clusterIdentifier?: string;
  workgroupName?: string;
  dbUser?: string;
  secretArn?: string;
}

/**
 * AWS identity for the control-plane features (CloudWatch metrics, and the
 * Cluster view in later M10 batches). Data API profiles already carry all of
 * this in `dataApi`; pg-wire profiles carry none of it, so these optional
 * fields — auto-filled from the endpoint host when it is a recognisable
 * Redshift endpoint — are what lets a `direct`/`direct+ssh` connection show
 * infrastructure metrics. Credentials themselves never live here: they come
 * from the AWS default chain (~/.aws), exactly like the Data API transport.
 */
export interface AwsOptions {
  region?: string;
  clusterIdentifier?: string;
  workgroupName?: string;
  /** Serverless storage metrics are dimensioned by namespace, not workgroup. */
  namespaceName?: string;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  kind: ProfileKind;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
  /**
   * Accept any TLS certificate (S-08). Absent/false = verify, which is the
   * default: encryption without verification stops a passive eavesdropper and
   * nothing else. Only turn this on for a network you have decided to trust.
   */
  sslInsecure?: boolean;
  /** Present when kind === 'direct+ssh'. */
  ssh?: SshOptions;
  /** Present when kind === 'data-api'. */
  dataApi?: DataApiOptions;
  /** Optional AWS identity for CloudWatch/console features (M10). */
  aws?: AwsOptions;
}

export function secretKeyForProfile(profileId: string): string {
  return `redlens.password.${profileId}`;
}

export function newProfileId(): string {
  // Stable, filesystem/config-safe id; no external uuid dependency needed.
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export interface ProfileValidationError {
  field: keyof ConnectionProfile;
  message: string;
}

export function validateProfile(p: Partial<ConnectionProfile>): ProfileValidationError[] {
  const errors: ProfileValidationError[] = [];
  if (!p.name || p.name.trim().length === 0) {
    errors.push({ field: 'name', message: 'Name is required' });
  }
  if (!p.host || p.host.trim().length === 0) {
    errors.push({ field: 'host', message: 'Host is required' });
  }
  if (p.port === undefined || !Number.isInteger(p.port) || p.port < 1 || p.port > 65535) {
    errors.push({ field: 'port', message: 'Port must be an integer between 1 and 65535' });
  }
  if (!p.database || p.database.trim().length === 0) {
    errors.push({ field: 'database', message: 'Database is required' });
  }
  if (!p.username || p.username.trim().length === 0) {
    errors.push({ field: 'username', message: 'Username is required' });
  }
  return errors;
}
