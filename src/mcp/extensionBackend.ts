import { queryAll } from '../query/collect';
import { maskRows, type PiiConfig } from '../pii/piiMask';
import type { BridgeBackend } from './bridgeCore';
import type { ConnectionManager } from '../connections/connectionManager';
import type { ConnectionStore } from '../connections/connectionStore';
import type { MetadataService } from '../metadata/metadataService';

/**
 * BridgeBackend over the live extension state: agents see exactly the
 * connections the user configured, and queries run on the ACTIVE connection.
 */
export class ExtensionBridgeBackend implements BridgeBackend {
  constructor(
    private readonly store: ConnectionStore,
    private readonly manager: ConnectionManager,
    private readonly metadata: MetadataService,
    /** pii-safe-mode: masks PII columns BEFORE results leave for the LLM. */
    private readonly getPiiConfig: () => PiiConfig = () => ({ enabled: false, patterns: [] }),
  ) {}

  listConnections(): Promise<{ id: string; name: string; kind: string; active: boolean }[]> {
    const activeId = this.manager.getActive()?.profile.id;
    return Promise.resolve(
      this.store.getProfiles().map((p) => ({ id: p.id, name: p.name, kind: p.kind, active: p.id === activeId })),
    );
  }

  async listSchemas(): Promise<string[]> {
    this.requireActive();
    return this.metadata.listSchemas();
  }

  async listTables(schema: string): Promise<{ name: string; kind: string }[]> {
    this.requireActive();
    const tables = await this.metadata.listTables(schema);
    return tables.map((t) => ({ name: t.name, kind: t.kind }));
  }

  async listColumns(schema: string, table: string): Promise<{ name: string; typeName: string; nullable: boolean }[]> {
    this.requireActive();
    return this.metadata.listColumns(schema, table);
  }

  async executeReadOnly(sql: string, maxRows: number): Promise<{
    columns: { name: string; typeName: string }[];
    rows: unknown[][];
    rowCount: number;
    truncated: boolean;
  }> {
    const active = this.requireActive();
    // Engine-level enforcement: for SQL transports the statement runs inside a
    // READ ONLY transaction — any write fails in the engine regardless of what
    // slipped past the parser. Demo is read-only by construction.
    const wrapped =
      active.profile.kind === 'demo' ? sql : `BEGIN TRANSACTION READ ONLY;\n${sql}\n;COMMIT;`;
    let result;
    try {
      result = await queryAll(active.transport, wrapped);
    } catch (err) {
      // A failed statement leaves the session in an aborted transaction —
      // recover it so the next call (and the user's own queries) still work.
      if (active.profile.kind !== 'demo') {
        await queryAll(active.transport, 'ROLLBACK').catch(() => undefined);
      }
      throw err;
    }
    const { columns, rows } = result;
    const truncated = rows.length > maxRows;
    const capped = truncated ? rows.slice(0, maxRows) : rows;
    // pii-safe-mode: an AI agent must never receive raw PII — mask configured
    // columns here, at the last hop before results leave the extension.
    const masked = maskRows(columns, capped, this.getPiiConfig());
    return {
      columns: columns.map((c) => ({ name: c.name, typeName: c.typeName })),
      rows: masked,
      rowCount: rows.length,
      truncated,
    };
  }

  private requireActive() {
    const active = this.manager.getActive();
    if (active === undefined) {
      throw new Error('no active RedLens connection — connect one in VS Code first (status bar → RedLens: Connect)');
    }
    return active;
  }
}
