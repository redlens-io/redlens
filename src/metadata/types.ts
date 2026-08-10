export interface TableInfo {
  schema: string;
  name: string;
  kind: 'table' | 'view' | 'external';
}

export interface ColumnMeta {
  name: string;
  typeName: string;
  nullable: boolean;
}

export interface ForeignKey {
  column: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
}

/**
 * Metadata behind an interface so each connection kind brings its own
 * implementation: SQL (dual dialect) for live databases, fixtures for demo.
 */
export interface MetadataSource {
  listSchemas(): Promise<string[]>;
  listTables(schema: string): Promise<TableInfo[]>;
  listColumns(schema: string, table: string): Promise<ColumnMeta[]>;
  /** Foreign keys declared on a table (informational on Redshift). */
  listForeignKeys(schema: string, table: string): Promise<ForeignKey[]>;
  /** Primary-key column names (for inline edit / DML). Empty if none. */
  listPrimaryKey(schema: string, table: string): Promise<string[]>;
}
