/**
 * Which warehouse a connection points at, and how we work that out.
 *
 * Split out of `cloudWatch.ts` in the Fase O open-core split. The metrics that
 * file existed for are a paid feature and moved to the Pro extension, but
 * target resolution could not go with them: the **Free** Properties section of
 * the Cluster view uses exactly the same logic to find its cluster, and so does
 * the read-only console. It is shared infrastructure, so it stays open.
 *
 * The name kept the CloudWatch prefix (`CloudWatchTarget`) on purpose — it is
 * the type the Pro dashboard is coded against, and renaming it across the
 * bridge contract would have been churn with no reader-facing gain.
 */
// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

export interface ProvisionedTarget {
  kind: 'provisioned';
  region: string;
  clusterIdentifier: string;
}

export interface ServerlessTarget {
  kind: 'serverless';
  region: string;
  workgroupName: string;
  /** Needed for the storage metrics, which are dimensioned by Namespace. */
  namespaceName?: string;
}

export type CloudWatchTarget = ProvisionedTarget | ServerlessTarget;

/**
 * AWS resource names that are safe to interpolate into a metric SEARCH
 * expression. Redshift cluster ids and workgroup names are already restricted
 * to lowercase alphanumerics and hyphens, so anything else is either not a real
 * name or an attempt to break out of the quoted expression — we drop those
 * metrics instead of sending them.
 */
export function isSafeAwsName(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}

export function isSafeRegion(value: string): boolean {
  return /^[a-z0-9-]{1,32}$/.test(value);
}

export interface ParsedEndpoint {
  region?: string;
  clusterIdentifier?: string;
  workgroupName?: string;
}

/**
 * Recover the AWS identity of a pg-wire profile from its endpoint. Redshift
 * endpoints carry everything we need:
 *   mycluster.abc123.us-east-1.redshift.amazonaws.com            → provisioned
 *   mywg.123456789012.us-east-1.redshift-serverless.amazonaws.com → serverless
 * Returns {} for anything unrecognised (tunnels, localhost, custom domains) —
 * the user can still fill the fields in by hand.
 */
export function parseRedshiftEndpoint(host: string): ParsedEndpoint {
  const labels = host.trim().toLowerCase().replace(/\.$/, '').split('.');
  const marker = labels.findIndex((l) => l === 'redshift' || l === 'redshift-serverless');
  // Need <name>.<account>.<region>.<marker> — anything shorter isn't an endpoint.
  if (marker < 3) {
    return {};
  }
  const name = labels[0] ?? '';
  const region = labels[marker - 1] ?? '';
  if (!isSafeAwsName(name) || !isSafeRegion(region)) {
    return {};
  }
  return labels[marker] === 'redshift-serverless'
    ? { region, workgroupName: name }
    : { region, clusterIdentifier: name };
}


export type UnavailableReason = 'not-redshift' | 'no-identity';

export interface TargetResolution {
  target?: CloudWatchTarget;
  reason?: UnavailableReason;
}

/**
 * Work out which cluster/workgroup a profile points at. Data API profiles state
 * it outright; pg-wire profiles get it from explicit settings first and from
 * the endpoint host second — never guessed from anything else, because a wrong
 * cluster id silently charts someone else's warehouse.
 */
export function resolveTarget(profile: {
  kind: string;
  host?: string;
  dataApi?: { region: string; clusterIdentifier?: string; workgroupName?: string };
  aws?: { region?: string; clusterIdentifier?: string; workgroupName?: string; namespaceName?: string };
}): TargetResolution {
  if (profile.kind === 'demo' || profile.kind === 'compat') {
    return { reason: 'not-redshift' };
  }

  if (profile.kind === 'data-api' && profile.dataApi !== undefined) {
    const { region, clusterIdentifier, workgroupName } = profile.dataApi;
    if (workgroupName !== undefined) {
      return { target: { kind: 'serverless', region, workgroupName, namespaceName: profile.aws?.namespaceName } };
    }
    if (clusterIdentifier !== undefined) {
      return { target: { kind: 'provisioned', region, clusterIdentifier } };
    }
    return { reason: 'no-identity' };
  }

  const parsed = parseRedshiftEndpoint(profile.host ?? '');
  const region = profile.aws?.region ?? parsed.region;
  const workgroupName = profile.aws?.workgroupName ?? parsed.workgroupName;
  const clusterIdentifier = profile.aws?.clusterIdentifier ?? parsed.clusterIdentifier;
  if (region === undefined) {
    return { reason: 'no-identity' };
  }
  if (workgroupName !== undefined) {
    return { target: { kind: 'serverless', region, workgroupName, namespaceName: profile.aws?.namespaceName } };
  }
  if (clusterIdentifier !== undefined) {
    return { target: { kind: 'provisioned', region, clusterIdentifier } };
  }
  return { reason: 'no-identity' };
}
