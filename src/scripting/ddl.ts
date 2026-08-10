/**
 * Object scripting (M2 `object-scripting`): generate DDL / SELECT / INSERT from
 * a table's column metadata. Pure/testable; the command opens the result in an
 * editor. Identifiers are quoted only when they need it (non-simple names).
 */
export interface ScriptColumn {
  name: string;
  typeName: string;
  nullable: boolean;
}

export function ident(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}

export function qualified(schema: string, table: string): string {
  return `${ident(schema)}.${ident(table)}`;
}

export function buildCreateTable(schema: string, table: string, columns: readonly ScriptColumn[]): string {
  if (columns.length === 0) {
    return `-- no column metadata for ${qualified(schema, table)}`;
  }
  const nameWidth = Math.max(...columns.map((c) => ident(c.name).length));
  const typeWidth = Math.max(...columns.map((c) => c.typeName.length));
  const lines = columns.map((c, i) => {
    const comma = i < columns.length - 1 ? ',' : '';
    const nn = c.nullable ? '' : ' NOT NULL';
    return `  ${ident(c.name).padEnd(nameWidth)} ${c.typeName.padEnd(typeWidth)}${nn}${comma}`;
  });
  return `CREATE TABLE ${qualified(schema, table)} (\n${lines.join('\n')}\n);`;
}

export function buildSelect(schema: string, table: string, columns: readonly ScriptColumn[]): string {
  const cols = columns.length > 0 ? columns.map((c) => `  ${ident(c.name)}`).join(',\n') : '  *';
  return `SELECT\n${cols}\nFROM ${qualified(schema, table)}\nLIMIT 100;`;
}

export function buildInsert(schema: string, table: string, columns: readonly ScriptColumn[]): string {
  if (columns.length === 0) {
    return `INSERT INTO ${qualified(schema, table)} VALUES ();`;
  }
  const cols = columns.map((c) => ident(c.name)).join(', ');
  const placeholders = columns.map((c) => `:${c.name}`).join(', ');
  return `INSERT INTO ${qualified(schema, table)} (${cols})\nVALUES (${placeholders});`;
}
