import { queryAll } from '../query/collect';
import type { ColumnMeta, ForeignKey, MetadataSource, TableInfo } from './types';
import type { BufferedTransport } from '../transport/types';

export type MetadataDialect = 'compat' | 'redshift';

/** Single-quote SQL literal escaping for internal metadata queries. */
export function lit(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * SQL-backed metadata with dual dialect (PLAN §5.2):
 *  - redshift → SVV_ALL_* (sees external/Spectrum and datashares; the PG-8.0-era
 *    catalog and information_schema do NOT)
 *  - compat   → information_schema (vanilla Postgres used in local testing)
 */
export class SqlMetadataSource implements MetadataSource {
  constructor(
    private readonly transport: BufferedTransport,
    private readonly dialect: MetadataDialect,
  ) {}

  async listSchemas(): Promise<string[]> {
    const sql =
      this.dialect === 'redshift'
        ? `SELECT schema_name FROM svv_all_schemas WHERE database_name = current_database() ORDER BY schema_name`
        : `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema') AND schema_name NOT LIKE 'pg!_%' ESCAPE '!' ORDER BY schema_name`;
    const { rows } = await queryAll(this.transport, sql);
    return rows.map((r) => String(r[0]));
  }

  async listTables(schema: string): Promise<TableInfo[]> {
    const sql =
      this.dialect === 'redshift'
        ? `SELECT table_name, table_type FROM svv_all_tables WHERE database_name = current_database() AND schema_name = ${lit(schema)} ORDER BY table_name`
        : `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = ${lit(schema)} ORDER BY table_name`;
    const { rows } = await queryAll(this.transport, sql);
    return rows.map((r) => ({
      schema,
      name: String(r[0]),
      kind: normalizeTableKind(String(r[1] ?? '')),
    }));
  }

  async listColumns(schema: string, table: string): Promise<ColumnMeta[]> {
    const sql =
      this.dialect === 'redshift'
        ? `SELECT column_name, data_type, is_nullable FROM svv_all_columns WHERE database_name = current_database() AND schema_name = ${lit(schema)} AND table_name = ${lit(table)} ORDER BY ordinal_position`
        : `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = ${lit(schema)} AND table_name = ${lit(table)} ORDER BY ordinal_position`;
    const { rows } = await queryAll(this.transport, sql);
    return rows.map((r) => ({
      name: String(r[0]),
      typeName: String(r[1] ?? 'unknown'),
      nullable: String(r[2] ?? 'YES').toUpperCase() !== 'NO',
    }));
  }

  async listForeignKeys(schema: string, table: string): Promise<ForeignKey[]> {
    // pg_constraint works on both Postgres and Redshift (leader-node catalog).
    // Single-column FKs only (composite would need conkey/confkey ordinal join).
    const sql = `
      SELECT att.attname, ns2.nspname, cl2.relname, att2.attname
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN pg_class cl2 ON cl2.oid = c.confrelid
      JOIN pg_namespace ns2 ON ns2.oid = cl2.relnamespace
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = c.conkey[1]
      JOIN pg_attribute att2 ON att2.attrelid = c.confrelid AND att2.attnum = c.confkey[1]
      WHERE c.contype = 'f' AND ns.nspname = ${lit(schema)} AND cl.relname = ${lit(table)}`;
    try {
      const { rows } = await queryAll(this.transport, sql);
      return rows.map((r) => ({
        column: String(r[0]),
        refSchema: String(r[1]),
        refTable: String(r[2]),
        refColumn: String(r[3]),
      }));
    } catch {
      // FK catalog may be unavailable on some engines/permissions — degrade gracefully.
      return [];
    }
  }

  async listPrimaryKey(schema: string, table: string): Promise<string[]> {
    const sql = `
      SELECT att.attname
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = ANY(c.conkey)
      WHERE c.contype = 'p' AND ns.nspname = ${lit(schema)} AND cl.relname = ${lit(table)}
      ORDER BY att.attnum`;
    try {
      const { rows } = await queryAll(this.transport, sql);
      return rows.map((r) => String(r[0]));
    } catch {
      return [];
    }
  }
}

export function normalizeTableKind(raw: string): TableInfo['kind'] {
  const upper = raw.toUpperCase();
  if (upper.includes('EXTERNAL')) {
    return 'external';
  }
  if (upper.includes('VIEW')) {
    return 'view';
  }
  return 'table';
}
