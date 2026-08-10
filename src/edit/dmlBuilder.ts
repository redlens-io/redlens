/**
 * DML builder (M4 `inline-data-edit` / `dml-preview`): generates UPDATE / INSERT
 * / DELETE from grid edits using the table's primary key. Pure/testable; the
 * command previews the SQL and runs it inside a transaction.
 */
export function ident(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}

export function sqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `'${text.replaceAll("'", "''")}'`;
}

function whereByPk(pk: Record<string, unknown>): string {
  const keys = Object.keys(pk);
  if (keys.length === 0) {
    throw new Error('cannot build DML without a primary key');
  }
  return keys.map((k) => `${ident(k)} = ${sqlValue(pk[k])}`).join(' AND ');
}

export interface RowUpdate {
  pk: Record<string, unknown>;
  changes: Record<string, unknown>;
}

export function buildUpdate(table: string, edit: RowUpdate): string {
  const cols = Object.keys(edit.changes);
  if (cols.length === 0) {
    return `-- no changes for ${table}`;
  }
  const set = cols.map((c) => `${ident(c)} = ${sqlValue(edit.changes[c])}`).join(', ');
  return `UPDATE ${table} SET ${set} WHERE ${whereByPk(edit.pk)};`;
}

export function buildInsert(table: string, row: Record<string, unknown>): string {
  const cols = Object.keys(row);
  return `INSERT INTO ${table} (${cols.map(ident).join(', ')}) VALUES (${cols.map((c) => sqlValue(row[c])).join(', ')});`;
}

export function buildDelete(table: string, pk: Record<string, unknown>): string {
  return `DELETE FROM ${table} WHERE ${whereByPk(pk)};`;
}

export interface ChangeSet {
  table: string;
  updates: RowUpdate[];
  inserts: Record<string, unknown>[];
  deletes: Record<string, unknown>[];
}

/** Full preview SQL for a change-set, wrapped in a transaction. */
export function buildChangeSetSql(cs: ChangeSet): string {
  const stmts: string[] = [];
  for (const u of cs.updates) {
    const sql = buildUpdate(cs.table, u);
    if (!sql.startsWith('--')) {
      stmts.push(sql);
    }
  }
  for (const i of cs.inserts) {
    stmts.push(buildInsert(cs.table, i));
  }
  for (const d of cs.deletes) {
    stmts.push(buildDelete(cs.table, d));
  }
  if (stmts.length === 0) {
    return '-- no pending changes';
  }
  return ['BEGIN;', ...stmts, 'COMMIT;'].join('\n');
}
