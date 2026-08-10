/**
 * table-designer (M7): build a Redshift `CREATE TABLE` from a column spec, with
 * the Redshift-specific clauses (ENCODE, DISTKEY, SORTKEY, DISTSTYLE). Pure/
 * testable; the command feeds it a spec or emits a commented template scaffold.
 */
export interface ColumnDef {
  name: string;
  type: string;
  nullable?: boolean;
  encode?: string;
  distkey?: boolean;
  /** 1-based position in the compound sort key (undefined = not a sort key). */
  sortkey?: number;
}

export interface TableDef {
  schema: string;
  table: string;
  columns: ColumnDef[];
  diststyle?: 'AUTO' | 'EVEN' | 'KEY' | 'ALL';
}

function ident(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}

export function buildRedshiftCreateTable(def: TableDef): string {
  if (def.columns.length === 0) {
    return `-- ${def.schema}.${def.table}: add at least one column`;
  }
  const colLines = def.columns.map((c) => {
    // Redshift column grammar order: type [ENCODE] [DISTKEY] [SORTKEY] [constraints].
    // NOT NULL is a column constraint, so it must come AFTER ENCODE/DISTKEY.
    const parts = [`${ident(c.name)} ${c.type}`];
    if (c.encode !== undefined) parts.push(`ENCODE ${c.encode}`);
    if (c.distkey === true) parts.push('DISTKEY');
    if (c.nullable === false) parts.push('NOT NULL');
    return `  ${parts.join(' ')}`;
  });
  const sortCols = def.columns
    .filter((c) => c.sortkey !== undefined)
    .sort((a, b) => (a.sortkey ?? 0) - (b.sortkey ?? 0))
    .map((c) => ident(c.name));
  const tail: string[] = [];
  if (def.diststyle !== undefined) tail.push(`DISTSTYLE ${def.diststyle}`);
  if (sortCols.length > 0) tail.push(`SORTKEY(${sortCols.join(', ')})`);
  const tailSql = tail.length > 0 ? `\n${tail.join('\n')}` : '';
  return `CREATE TABLE ${ident(def.schema)}.${ident(def.table)} (\n${colLines.join(',\n')}\n)${tailSql};`;
}

/** A commented CREATE TABLE scaffold explaining the Redshift knobs. */
export function createTableTemplate(schema: string, table: string): string {
  const def: TableDef = {
    schema,
    table,
    diststyle: 'KEY',
    columns: [
      { name: 'id', type: 'bigint', nullable: false, distkey: true },
      { name: 'name', type: 'varchar(256)', nullable: false },
      { name: 'amount', type: 'numeric(12,2)' },
      { name: 'created_at', type: 'timestamp', nullable: false, sortkey: 1 },
    ],
  };
  return [
    `-- RedLens table template for ${schema}.${table} — edit the columns and keys, then run.`,
    '-- Redshift tips: pick a DISTKEY on the most common JOIN column (or DISTSTYLE ALL for',
    '-- small dimensions); pick a SORTKEY on the column you filter/range-scan on most.',
    '',
    buildRedshiftCreateTable(def),
  ].join('\n');
}
