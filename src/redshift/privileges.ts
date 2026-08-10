/**
 * Object privileges (M8b2): "who can do what on this table/schema", including
 * grants made to RBAC roles (which not even DBeaver PRO surfaces per object —
 * open issue #38688) and column-level grants (invisible in
 * SVV_RELATION_PRIVILEGES). Pure/testable: SQL + tolerant parsers + GRANT/REVOKE
 * code generation. See PLAN-M8-GOBERNANZA §3/§4.
 *
 * AWS recommends SHOW GRANTS over the SVV_* views (it covers local, datashare,
 * and federated catalogs and stays current), so SHOW GRANTS is the authoritative
 * path here; SVV_RELATION_PRIVILEGES is the documented fallback and
 * SVV_COLUMN_PRIVILEGES the best-effort probe for column grants.
 */

export type GranteeType = 'user' | 'role' | 'group' | 'public';

export interface PrivilegeGrant {
  grantee: string;
  granteeType: GranteeType;
  privilege: string; // SELECT | INSERT | UPDATE | DELETE | REFERENCES | DROP | ...
  withGrantOption: boolean;
  /** Set only for column-level grants (GRANT SELECT(c1,c2) ...). */
  column?: string;
}

export interface ObjectRef {
  kind: 'table' | 'schema';
  schema: string;
  /** Table/view name; omitted for a schema ref. */
  name?: string;
}

export interface ObjectPrivileges {
  grants: PrivilegeGrant[];
  /** True when the column-grant probe failed/was unsupported (display caveat). */
  columnGrantsBestEffort: boolean;
  /** Which path produced the object-level grants. */
  source: 'show-grants' | 'svv';
}

export function objectRefSql(ref: ObjectRef): string {
  return ref.kind === 'schema' ? `SCHEMA ${ident(ref.schema)}` : `TABLE ${ident(ref.schema)}.${ident(ref.name ?? '')}`;
}

/** Qualified object label for headings (schema.table or just schema). */
export function objectLabel(ref: ObjectRef): string {
  return ref.kind === 'schema' ? ref.schema : `${ref.schema}.${ref.name ?? ''}`;
}

// --- SQL --------------------------------------------------------------------

export function sqlShowGrants(ref: ObjectRef): string {
  return ref.kind === 'schema'
    ? `SHOW GRANTS ON SCHEMA ${ident(ref.schema)}`
    : `SHOW GRANTS ON TABLE ${ident(ref.schema)}.${ident(ref.name ?? '')}`;
}

/** Fallback if SHOW GRANTS is unavailable: SVV_RELATION_PRIVILEGES (tables). */
export function sqlRelationPrivileges(ref: ObjectRef): string {
  return (
    `SELECT identity_name, identity_type, privilege_type, admin_option ` +
    `FROM svv_relation_privileges ` +
    `WHERE namespace_name = ${lit(ref.schema)} AND relation_name = ${lit(ref.name ?? '')}`
  );
}

/** Best-effort probe for column-level grants (not in relation privileges). */
export function sqlColumnPrivileges(ref: ObjectRef): string {
  return (
    `SELECT identity_name, identity_type, privilege_type, column_name, admin_option ` +
    `FROM svv_column_privileges ` +
    `WHERE namespace_name = ${lit(ref.schema)} AND relation_name = ${lit(ref.name ?? '')}`
  );
}

// --- Parsers (map by column NAME — SHOW GRANTS column order is not stable) ---

function idx(columns: { name: string }[], ...candidates: string[]): number {
  const lower = columns.map((c) => c.name.toLowerCase());
  for (const cand of candidates) {
    const i = lower.indexOf(cand.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function normType(raw: string): GranteeType {
  const t = raw.toLowerCase();
  if (t.includes('role')) return 'role';
  if (t.includes('group')) return 'group';
  if (t.includes('public')) return 'public';
  return 'user';
}

function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === 'true' || s === 't' || s === '1' || s === 'yes';
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

export function parseShowGrants(columns: { name: string }[], rows: unknown[][]): PrivilegeGrant[] {
  const iName = idx(columns, 'identity_name', 'grantee', 'privilege_grantee');
  const iType = idx(columns, 'identity_type', 'grantee_type');
  const iPriv = idx(columns, 'privilege_type', 'privilege');
  const iAdmin = idx(columns, 'admin_option', 'is_grantable', 'grant_option');
  const iCol = idx(columns, 'column_name', 'column');
  const out: PrivilegeGrant[] = [];
  for (const r of rows) {
    const name = iName >= 0 ? str(r[iName]) : '';
    const priv = iPriv >= 0 ? str(r[iPriv]).toUpperCase() : '';
    if (name === '' || priv === '') continue; // skip header/summary rows
    const type = iType >= 0 ? normType(str(r[iType])) : 'user';
    const grant: PrivilegeGrant = {
      grantee: type === 'public' ? 'PUBLIC' : name,
      granteeType: type,
      privilege: priv,
      withGrantOption: iAdmin >= 0 ? bool(r[iAdmin]) : false,
    };
    if (iCol >= 0) {
      const col = str(r[iCol]);
      if (col !== '') grant.column = col;
    }
    out.push(grant);
  }
  return out;
}

/** SVV_COLUMN_PRIVILEGES rows → column-tagged grants (positional). */
export function parseColumnPrivileges(rows: unknown[][]): PrivilegeGrant[] {
  return rows.map((r) => ({
    grantee: normType(str(r[1])) === 'public' ? 'PUBLIC' : str(r[0]),
    granteeType: normType(str(r[1])),
    privilege: str(r[2]).toUpperCase(),
    column: str(r[3]) || undefined,
    withGrantOption: bool(r[4]),
  }));
}

// --- Code generation (GRANT/REVOKE for review — never executed here) --------

function granteeClause(g: PrivilegeGrant): string {
  if (g.granteeType === 'public') return 'PUBLIC';
  if (g.granteeType === 'role') return `ROLE ${ident(g.grantee)}`;
  if (g.granteeType === 'group') return `GROUP ${ident(g.grantee)}`;
  return ident(g.grantee);
}

function privClause(g: PrivilegeGrant): string {
  return g.column ? `${g.privilege} ( ${ident(g.column)} )` : g.privilege;
}

/** GRANT for a single grant row. */
export function generateGrant(ref: ObjectRef, g: PrivilegeGrant): string {
  const tail = g.withGrantOption ? ' WITH GRANT OPTION' : '';
  return `GRANT ${privClause(g)} ON ${objectRefSql(ref)} TO ${granteeClause(g)}${tail};`;
}

/** REVOKE for a single grant row. */
export function generateRevoke(ref: ObjectRef, g: PrivilegeGrant): string {
  return `REVOKE ${privClause(g)} ON ${objectRefSql(ref)} FROM ${granteeClause(g)};`;
}

/**
 * A review script that reconstructs the object's current grants (useful to
 * replicate permissions to another environment). Header comment names the
 * object; PUBLIC/owner/superuser implicits are NOT represented (they are not
 * grant rows) — a note says so.
 */
export function generateGrantScript(ref: ObjectRef, grants: PrivilegeGrant[]): string {
  const header =
    `-- Grants on ${objectLabel(ref)} (RedLens code-gen — review before running).\n` +
    `-- Note: object owner + superusers hold implicit rights not shown here.\n`;
  if (grants.length === 0) {
    return header + `-- No explicit grants found.\n`;
  }
  return header + grants.map((g) => generateGrant(ref, g)).join('\n') + '\n';
}

// --- helpers ----------------------------------------------------------------

/** Quote an identifier unless it is a safe bare lower-case identifier. */
export function ident(name: string): string {
  if (/^[a-z_][a-z0-9_]*$/.test(name)) return name;
  return `"${name.replaceAll('"', '""')}"`;
}

function lit(v: string): string {
  return `'${v.replaceAll("'", "''")}'`;
}
