/**
 * Security policies (M8b4): row-level security (RLS) and dynamic data masking,
 * read-only. These silently filter rows / mask values for every query, so an
 * explorer that ignores them misleads — surfacing them explains "why are rows /
 * values missing". Pure/testable: SQL + parsers. See PLAN-M8-GOBERNANZA §3.
 *
 * Visibility: the SVV_RLS_* / SVV_MASKING_* views generally need superuser or
 * sys:secadmin — expect empty/denied for normal users (a degraded branch, shown
 * honestly by the tree, never a throw).
 */

export interface RlsPolicy {
  name: string;
  schema?: string;
  /** Relations this policy is attached to (best-effort join). */
  attachedTo: string[];
}

export interface MaskingPolicy {
  name: string;
  /** column(s) the policy masks, when known. */
  inputColumns?: string;
}

// --- SQL --------------------------------------------------------------------

export const SQL_RLS_POLICIES =
  `SELECT policy_name, policy_schema FROM svv_rls_policy ORDER BY policy_name`;

/** Which relations each policy is attached to (for the child count/labels). */
export const SQL_RLS_ATTACHED =
  `SELECT policy_name, relation_name FROM svv_rls_attached_policy`;

export const SQL_MASKING_POLICIES =
  `SELECT policy_name, input_columns FROM svv_masking_policy ORDER BY policy_name`;

// --- Parsers ----------------------------------------------------------------

function s(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

export function parseRlsPolicies(policyRows: unknown[][], attachedRows: unknown[][]): RlsPolicy[] {
  const attached = new Map<string, string[]>();
  for (const r of attachedRows) {
    const name = s(r[0]);
    const rel = s(r[1]);
    if (name === '') continue;
    const list = attached.get(name) ?? [];
    if (rel !== '') list.push(rel);
    attached.set(name, list);
  }
  return policyRows
    .filter((r) => s(r[0]) !== '')
    .map((r) => {
      const name = s(r[0]);
      return { name, schema: s(r[1]) || undefined, attachedTo: attached.get(name) ?? [] };
    });
}

export function parseMaskingPolicies(rows: unknown[][]): MaskingPolicy[] {
  return rows
    .filter((r) => s(r[0]) !== '')
    .map((r) => ({ name: s(r[0]), inputColumns: s(r[1]) || undefined }));
}
