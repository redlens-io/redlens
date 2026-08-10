import * as vscode from 'vscode';
import { SqlMetadataSource } from './sqlSource';
import type { ColumnMeta, ForeignKey, MetadataSource, TableInfo } from './types';
import type { ActiveConnection, ConnectionManager } from '../connections/connectionManager';

/**
 * Caches metadata for the active connection and invalidates on connection
 * change. Consumers: schema explorer and the completion provider.
 */
export class MetadataService implements vscode.Disposable {
  private source: MetadataSource | undefined;
  private schemas: string[] | undefined;
  private readonly tablesBySchema = new Map<string, TableInfo[]>();
  private readonly columnsByTable = new Map<string, ColumnMeta[]>();
  private readonly fksByTable = new Map<string, ForeignKey[]>();
  private readonly pkByTable = new Map<string, string[]>();

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly sub: vscode.Disposable;

  constructor(manager: ConnectionManager) {
    this.sub = manager.onDidChangeActive((active) => {
      this.reset(active);
    });
  }

  /** Demo connections inject their fixture source here; SQL ones are derived. */
  private reset(active: ActiveConnection | undefined): void {
    this.schemas = undefined;
    this.tablesBySchema.clear();
    this.columnsByTable.clear();
    this.fksByTable.clear();
    this.pkByTable.clear();
    if (active === undefined) {
      this.source = undefined;
    } else if (active.metadataSource !== undefined) {
      this.source = active.metadataSource;
    } else {
      const dialect = active.profile.kind === 'direct' ? 'redshift' : 'compat';
      this.source = new SqlMetadataSource(active.transport, dialect);
    }
    this.changeEmitter.fire();
  }

  hasSource(): boolean {
    return this.source !== undefined;
  }

  async listSchemas(): Promise<string[]> {
    if (this.source === undefined) {
      return [];
    }
    this.schemas ??= await this.source.listSchemas();
    return this.schemas;
  }

  async listTables(schema: string): Promise<TableInfo[]> {
    if (this.source === undefined) {
      return [];
    }
    let tables = this.tablesBySchema.get(schema);
    if (tables === undefined) {
      tables = await this.source.listTables(schema);
      this.tablesBySchema.set(schema, tables);
    }
    return tables;
  }

  async listColumns(schema: string, table: string): Promise<ColumnMeta[]> {
    if (this.source === undefined) {
      return [];
    }
    const key = `${schema}.${table}`;
    let columns = this.columnsByTable.get(key);
    if (columns === undefined) {
      columns = await this.source.listColumns(schema, table);
      this.columnsByTable.set(key, columns);
    }
    return columns;
  }

  async listForeignKeys(schema: string, table: string): Promise<ForeignKey[]> {
    if (this.source === undefined) {
      return [];
    }
    const key = `${schema}.${table}`;
    let fks = this.fksByTable.get(key);
    if (fks === undefined) {
      fks = await this.source.listForeignKeys(schema, table);
      this.fksByTable.set(key, fks);
    }
    return fks;
  }

  async listPrimaryKey(schema: string, table: string): Promise<string[]> {
    if (this.source === undefined) {
      return [];
    }
    const key = `${schema}.${table}`;
    let pk = this.pkByTable.get(key);
    if (pk === undefined) {
      pk = await this.source.listPrimaryKey(schema, table);
      this.pkByTable.set(key, pk);
    }
    return pk;
  }

  /** Synchronous cache views for the completion provider (no awaits mid-typing). */
  cachedSchemas(): string[] {
    return this.schemas ?? [];
  }

  cachedTables(schema: string): TableInfo[] {
    return this.tablesBySchema.get(schema) ?? [];
  }

  cachedColumns(schema: string, table: string): ColumnMeta[] {
    return this.columnsByTable.get(`${schema}.${table}`) ?? [];
  }

  invalidate(): void {
    this.schemas = undefined;
    this.tablesBySchema.clear();
    this.columnsByTable.clear();
    this.fksByTable.clear();
    this.pkByTable.clear();
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.sub.dispose();
    this.changeEmitter.dispose();
  }
}
