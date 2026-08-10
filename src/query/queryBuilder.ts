/**
 * visual-query-builder (M7): build a `SELECT` from a structured spec instead of
 * writing SQL by hand. Pure/testable; the webview collects the spec through a
 * form and this is the single source of truth for the generated SQL.
 */
export type FilterOp = '=' | '<>' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'ILIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';

export interface QueryFilter {
  column: string;
  op: FilterOp;
  value?: string;
  /** how this filter joins the previous one (ignored for the first) */
  connector?: 'AND' | 'OR';
}

export interface QueryJoin {
  table: string; // schema.table or table
  on: string; // raw ON condition, e.g. "s.eventid = e.eventid"
  kind?: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
}

export interface QueryOrder {
  column: string;
  dir?: 'ASC' | 'DESC';
}

export interface QuerySpec {
  schema: string;
  table: string;
  /** empty → SELECT * */
  columns?: string[];
  joins?: QueryJoin[];
  filters?: QueryFilter[];
  orderBy?: QueryOrder[];
  limit?: number;
  distinct?: boolean;
}

const OPS_NO_VALUE = new Set<FilterOp>(['IS NULL', 'IS NOT NULL']);

/** Quote an identifier unless it is a plain lowercase name, a qualified name
 * (a.b), or `*`. Keeps hand-written qualified columns like `s.eventid` intact. */
export function qIdent(name: string): string {
  const n = name.trim();
  if (n === '*') return '*';
  if (/^[a-z_][a-z0-9_$]*(\.[a-z_][a-z0-9_$]*|\.\*)?$/.test(n)) return n;
  return `"${n.replaceAll('"', '""')}"`;
}

function literal(raw: string): string {
  const v = raw.trim();
  if (v === '') return "''";
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(v)) return v; // numeric (no leading zeros)
  if (/^(true|false|null)$/i.test(v)) return v.toUpperCase();
  return `'${v.replaceAll("'", "''")}'`;
}

function renderFilter(f: QueryFilter): string {
  const col = qIdent(f.column);
  if (OPS_NO_VALUE.has(f.op)) return `${col} ${f.op}`;
  if (f.op === 'IN') {
    const items = (f.value ?? '').split(',').map((s) => literal(s)).filter((s) => s !== "''" || (f.value ?? '').includes(','));
    const list = items.length > 0 ? items.join(', ') : "''";
    return `${col} IN (${list})`;
  }
  return `${col} ${f.op} ${literal(f.value ?? '')}`;
}

export function buildSelectSql(spec: QuerySpec): string {
  const cols = spec.columns && spec.columns.length > 0 ? spec.columns.map(qIdent).join(', ') : '*';
  const from = `${qIdent(spec.schema)}.${qIdent(spec.table)}`;
  const lines: string[] = [`SELECT${spec.distinct ? ' DISTINCT' : ''} ${cols}`, `FROM ${from}`];

  for (const j of spec.joins ?? []) {
    const kind = j.kind && j.kind !== 'INNER' ? `${j.kind} JOIN` : 'JOIN';
    // j.table may already be qualified; qIdent keeps a.b intact.
    lines.push(`${kind} ${qIdent(j.table)} ON ${j.on}`);
  }

  const filters = spec.filters ?? [];
  if (filters.length > 0) {
    const parts = filters.map((f, i) => (i === 0 ? '' : `${f.connector ?? 'AND'} `) + renderFilter(f));
    lines.push(`WHERE ${parts.join('\n  ')}`);
  }

  const order = spec.orderBy ?? [];
  if (order.length > 0) {
    lines.push('ORDER BY ' + order.map((o) => `${qIdent(o.column)}${o.dir === 'DESC' ? ' DESC' : ''}`).join(', '));
  }

  // Emit LIMIT for any non-negative value — `LIMIT 0` is a real (if unusual)
  // limit the user can now express; `undefined` means no LIMIT (UXD-022).
  if (spec.limit !== undefined && Number.isFinite(spec.limit) && spec.limit >= 0) {
    lines.push(`LIMIT ${Math.floor(spec.limit)}`);
  }
  return lines.join('\n') + ';';
}
