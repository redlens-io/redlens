/**
 * Governance & sharing data layer (M8): datashares, users, roles — the surface
 * DBeaver CE lacks entirely for Redshift. Pure/testable: SQL constants + row
 * parsers + honest-degradation helpers. Live (SqlGovernanceSource) and demo
 * (fixtures) both produce these shapes; the explorer tree renders them.
 *
 * Visibility reality (AWS docs): SVV_USER_GRANTS / SVV_ROLE_GRANTS need
 * superuser or ACCESS SYSTEM TABLE — a normal user sees only their own grants.
 * The UI must say "partial view", never throw. See PLAN-M8-GOBERNANZA §3.
 */

import {
  sqlShowGrants,
  sqlRelationPrivileges,
  sqlColumnPrivileges,
  parseShowGrants,
  parseColumnPrivileges,
  type ObjectRef,
  type ObjectPrivileges,
  type PrivilegeGrant,
} from './privileges';
import {
  SQL_RLS_POLICIES,
  SQL_RLS_ATTACHED,
  SQL_MASKING_POLICIES,
  parseRlsPolicies,
  parseMaskingPolicies,
  type RlsPolicy,
  type MaskingPolicy,
} from './securityPolicies';

export interface Datashare {
  name: string;
  /** INBOUND = consumed here; OUTBOUND = produced here. */
  direction: 'inbound' | 'outbound';
  producerAccount?: string;
  producerNamespace?: string;
  publicAccessible: boolean;
}

export interface DatashareObject {
  objectType: string; // table | schema | view | function
  objectName: string;
}

export interface DatashareConsumer {
  consumerAccount?: string;
  consumerNamespace?: string;
  consumerRegion?: string;
}

export interface DbUser {
  name: string;
  superuser: boolean;
  createDb: boolean;
  /** IAM:/IAMR:/AWSIDC:/<idp>: prefix → managed externally; admin DDL disabled. */
  federated: boolean;
  /** internal AWS user (rdsdb) — excluded from any admin action. */
  system: boolean;
}

export interface DbRole {
  name: string;
  owner?: string;
  /** sys:* built-in roles (sys:secadmin, sys:operator, …). */
  system: boolean;
}

/** SVV_USER_GRANTS row: a role granted directly to a user. */
export interface UserRoleGrant {
  user: string;
  role: string;
}

/** SVV_ROLE_GRANTS row: a role (`held`) granted to another role (`grantee`). */
export interface RoleRoleGrant {
  grantee: string;
  held: string;
}

// --- SQL (Redshift) ---------------------------------------------------------
// Column order matters: the parsers below index positionally.

export const SQL_DATASHARES =
  `SELECT share_name, share_type, producer_account, producer_namespace, is_publicaccessible FROM svv_datashares ORDER BY share_type, share_name`;

export const sqlDatashareObjects = (shareName: string): string =>
  `SELECT object_type, object_name FROM svv_datashare_objects WHERE share_name = '${esc(shareName)}' ORDER BY object_type, object_name`;

export const sqlDatashareConsumers = (shareName: string): string =>
  `SELECT consumer_account, consumer_namespace, consumer_region FROM svv_datashare_consumers WHERE share_name = '${esc(shareName)}'`;

/** Users: pg_user is readable by all; usesuper/usecreatedb are the flags. */
export const SQL_USERS =
  `SELECT usename, usesuper, usecreatedb FROM pg_user ORDER BY usename`;

/** RBAC roles (Redshift-native, distinct from legacy groups). */
export const SQL_ROLES =
  `SELECT role_name, role_owner FROM svv_roles ORDER BY role_name`;

/** Namespace GUID = the sharing identity (producer/consumer hand this off). */
export const SQL_CURRENT_NAMESPACE = `SELECT current_namespace`;

/** Membership (superuser/ACCESS SYSTEM TABLE gated — degrades to partial). */
export const SQL_USER_GRANTS = `SELECT user_name, role_name FROM svv_user_grants`;
export const SQL_ROLE_GRANTS = `SELECT role_name, granted_role_name FROM svv_role_grants`;

// --- Row parsers (positional; rows are unknown[][] from queryAll) -----------

function b(v: unknown): boolean {
  // Redshift returns booleans as true/false, 't'/'f', or 1/0 depending on path.
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === 'true' || s === 't' || s === '1';
}
function s(v: unknown): string { return v === null || v === undefined ? '' : String(v); }

const FEDERATED_PREFIX = /^(IAM:|IAMR:|AWSIDC:|[A-Za-z0-9_-]+:)/;

/** Externally-managed identity (IAM/IdC/IdP) — user admin DDL must be blocked. */
export function isFederatedName(name: string): boolean {
  return name.includes(':') && FEDERATED_PREFIX.test(name);
}

/** Internal AWS user — never an admin target. */
export function isSystemUserName(name: string): boolean {
  return name === 'rdsdb';
}

export function parseDatashares(rows: unknown[][]): Datashare[] {
  return rows.map((r) => ({
    name: s(r[0]),
    direction: s(r[1]).toUpperCase() === 'OUTBOUND' ? 'outbound' : 'inbound',
    producerAccount: s(r[2]) || undefined,
    producerNamespace: s(r[3]) || undefined,
    publicAccessible: b(r[4]),
  }));
}

export function parseDatashareObjects(rows: unknown[][]): DatashareObject[] {
  return rows.map((r) => ({ objectType: s(r[0]), objectName: s(r[1]) }));
}

export function parseDatashareConsumers(rows: unknown[][]): DatashareConsumer[] {
  return rows.map((r) => ({
    consumerAccount: s(r[0]) || undefined,
    consumerNamespace: s(r[1]) || undefined,
    consumerRegion: s(r[2]) || undefined,
  }));
}

export function parseUsers(rows: unknown[][]): DbUser[] {
  return rows.map((r) => {
    const name = s(r[0]);
    return {
      name,
      superuser: b(r[1]),
      createDb: b(r[2]),
      // A ':' with a known prefix means an externally-managed identity; a plain
      // name never matches because there is no ':' in a normal Redshift user.
      federated: isFederatedName(name),
      system: isSystemUserName(name),
    };
  });
}

export function parseRoles(rows: unknown[][]): DbRole[] {
  return rows.map((r) => {
    const name = s(r[0]);
    return { name, owner: s(r[1]) || undefined, system: name.startsWith('sys:') };
  });
}

export function parseUserRoleGrants(rows: unknown[][]): UserRoleGrant[] {
  return rows.filter((r) => s(r[0]) !== '' && s(r[1]) !== '').map((r) => ({ user: s(r[0]), role: s(r[1]) }));
}

/** grantee = role_name (the member role); held = granted_role_name it inherits. */
export function parseRoleRoleGrants(rows: unknown[][]): RoleRoleGrant[] {
  return rows.filter((r) => s(r[0]) !== '' && s(r[1]) !== '').map((r) => ({ grantee: s(r[0]), held: s(r[1]) }));
}

/** Three-part name to query a shared object from a consumer (db.schema.table). */
export function threePartQuery(database: string, objectName: string): string {
  // objectName from svv_datashare_objects is already schema.table for tables.
  return `SELECT * FROM ${database}.${objectName} LIMIT 100;`;
}

/**
 * Build the query for a shared-object tree node (M8b1). Direction-aware:
 *  - outbound (producer side) → local 2-part name works directly
 *  - inbound (consumer side) → needs the local database created FROM the share,
 *    which svv_datashare_objects does not carry, so emit a marked placeholder
 *  - a shared schema is not directly queryable → a comment nudges to a table
 */
export function datashareObjectQuery(share: Datashare, object: DatashareObject): string {
  if (object.objectType === 'schema') {
    return `-- ${object.objectName} is a shared schema; pick a table inside it.\n`;
  }
  if (share.direction === 'outbound') {
    return `SELECT * FROM ${object.objectName} LIMIT 100;`;
  }
  const ns = share.producerNamespace ?? '...';
  return (
    `-- Replace <consumer_db> with the database created from '${share.name}'\n` +
    `-- (CREATE DATABASE <consumer_db> FROM DATASHARE ${share.name} OF NAMESPACE '${ns}';)\n` +
    `SELECT * FROM <consumer_db>.${object.objectName} LIMIT 100;`
  );
}

function esc(v: string): string { return v.replaceAll("'", "''"); }

// --- Source (live SQL + demo fixtures) --------------------------------------

/**
 * The governance surface behind an interface, mirroring MetadataSource. Every
 * method may reject; the tree turns a rejection into an honest info node
 * (partial view / permission / unsupported) rather than a blank.
 */
export interface GovernanceSource {
  /** False for plain-Postgres (compat): no svv_datashares/svv_roles exist. */
  readonly supported: boolean;
  listDatashares(): Promise<Datashare[]>;
  listDatashareObjects(shareName: string): Promise<DatashareObject[]>;
  listDatashareConsumers(shareName: string): Promise<DatashareConsumer[]>;
  listUsers(): Promise<DbUser[]>;
  listRoles(): Promise<DbRole[]>;
  /** Namespace GUID (sharing identity); undefined if unavailable. */
  currentNamespace(): Promise<string | undefined>;
  /** Who-can-do-what on a table/schema, incl. RBAC roles + column grants (b2). */
  objectPrivileges(ref: ObjectRef): Promise<ObjectPrivileges>;
  /** RLS + masking policies, read-only (b4). */
  listRlsPolicies(): Promise<RlsPolicy[]>;
  listMaskingPolicies(): Promise<MaskingPolicy[]>;
  /** Membership for effective-permissions (b4; superuser-gated → may be empty). */
  listUserRoleGrants(): Promise<UserRoleGrant[]>;
  listRoleRoleGrants(): Promise<RoleRoleGrant[]>;
}

/** Redshift connection kinds (everything but plain-Postgres compat and demo). */
export function isRedshiftKind(kind: string): boolean {
  return kind !== 'compat' && kind !== 'demo';
}

interface QueryRunner {
  (sql: string): Promise<{ columns: { name: string }[]; rows: unknown[][] }>;
}

/** Live source over any Redshift transport (Data API / pg-wire / SSH). */
export class SqlGovernanceSource implements GovernanceSource {
  readonly supported = true;
  constructor(private readonly run: QueryRunner) {}

  async objectPrivileges(ref: ObjectRef): Promise<ObjectPrivileges> {
    let grants: PrivilegeGrant[];
    let source: ObjectPrivileges['source'];
    try {
      const { columns, rows } = await this.run(sqlShowGrants(ref));
      grants = parseShowGrants(columns, rows);
      source = 'show-grants';
    } catch {
      // Older clusters / permissions: fall back to the SVV view (tables only).
      const { rows } = await this.run(sqlRelationPrivileges(ref));
      grants = parseShowGrants(
        [{ name: 'identity_name' }, { name: 'identity_type' }, { name: 'privilege_type' }, { name: 'admin_option' }],
        rows,
      );
      source = 'svv';
    }
    // Column-level grants are invisible in the above — probe separately.
    let columnGrantsBestEffort = false;
    if (ref.kind === 'table') {
      try {
        const { rows } = await this.run(sqlColumnPrivileges(ref));
        grants = grants.concat(parseColumnPrivileges(rows));
      } catch {
        columnGrantsBestEffort = true; // view absent or not permitted on this cluster
      }
    }
    return { grants, columnGrantsBestEffort, source };
  }

  async listDatashares(): Promise<Datashare[]> {
    return parseDatashares((await this.run(SQL_DATASHARES)).rows);
  }
  async listDatashareObjects(shareName: string): Promise<DatashareObject[]> {
    return parseDatashareObjects((await this.run(sqlDatashareObjects(shareName))).rows);
  }
  async listDatashareConsumers(shareName: string): Promise<DatashareConsumer[]> {
    return parseDatashareConsumers((await this.run(sqlDatashareConsumers(shareName))).rows);
  }
  async listUsers(): Promise<DbUser[]> {
    return parseUsers((await this.run(SQL_USERS)).rows);
  }
  async listRoles(): Promise<DbRole[]> {
    return parseRoles((await this.run(SQL_ROLES)).rows);
  }
  async currentNamespace(): Promise<string | undefined> {
    const { rows } = await this.run(SQL_CURRENT_NAMESPACE);
    return rows[0] ? s(rows[0][0]) || undefined : undefined;
  }
  async listRlsPolicies(): Promise<RlsPolicy[]> {
    const [policies, attached] = await Promise.all([this.run(SQL_RLS_POLICIES), this.run(SQL_RLS_ATTACHED)]);
    return parseRlsPolicies(policies.rows, attached.rows);
  }
  async listMaskingPolicies(): Promise<MaskingPolicy[]> {
    return parseMaskingPolicies((await this.run(SQL_MASKING_POLICIES)).rows);
  }
  async listUserRoleGrants(): Promise<UserRoleGrant[]> {
    return parseUserRoleGrants((await this.run(SQL_USER_GRANTS)).rows);
  }
  async listRoleRoleGrants(): Promise<RoleRoleGrant[]> {
    return parseRoleRoleGrants((await this.run(SQL_ROLE_GRANTS)).rows);
  }
}

/** Compat (plain Postgres): governance surface does not exist. */
export class UnsupportedGovernanceSource implements GovernanceSource {
  readonly supported = false;
  // Reject (not throw) so callers get a rejected Promise per the contract.
  private no(): Promise<never> {
    return Promise.reject(new Error('Governance requires a Redshift connection'));
  }
  listDatashares(): Promise<Datashare[]> { return this.no(); }
  listDatashareObjects(): Promise<DatashareObject[]> { return this.no(); }
  listDatashareConsumers(): Promise<DatashareConsumer[]> { return this.no(); }
  listUsers(): Promise<DbUser[]> { return this.no(); }
  listRoles(): Promise<DbRole[]> { return this.no(); }
  currentNamespace(): Promise<string | undefined> { return this.no(); }
  objectPrivileges(): Promise<ObjectPrivileges> { return this.no(); }
  listRlsPolicies(): Promise<RlsPolicy[]> { return this.no(); }
  listMaskingPolicies(): Promise<MaskingPolicy[]> { return this.no(); }
  listUserRoleGrants(): Promise<UserRoleGrant[]> { return this.no(); }
  listRoleRoleGrants(): Promise<RoleRoleGrant[]> { return this.no(); }
}
