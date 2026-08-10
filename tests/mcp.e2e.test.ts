import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BridgeServer, type BridgeBackend } from '../src/mcp/bridgeCore';
import { PgWireTransport } from '../src/transport/pgWire';
import { SqlMetadataSource } from '../src/metadata/sqlSource';
import { queryAll } from '../src/query/collect';
import { maskRows, MASK_TOKEN } from '../src/pii/piiMask';

/**
 * Full-protocol E2E (PLAN A3): a REAL MCP client talks stdio to the BUILT
 * dist bundle of the embedded server, which talks to a REAL BridgeServer
 * backed by a REAL Postgres (pg-compat). Only VS Code is out of the loop —
 * its role (launching the child) is played by StdioClientTransport.
 */
const HOST = process.env.REDLENS_PG_HOST;

describe.runIf(Boolean(HOST))('MCP server E2E (stdio protocol against built bundle)', () => {
  const transport = new PgWireTransport({
    host: HOST ?? '',
    port: Number.parseInt(process.env.REDLENS_PG_PORT ?? '15439', 10),
    database: process.env.REDLENS_PG_DB ?? 'redlens',
    user: process.env.REDLENS_PG_USER ?? 'redlens',
    password: process.env.REDLENS_PG_PASSWORD ?? 'redlens',
    ssl: false,
  });
  const metadata = new SqlMetadataSource(transport, 'compat');

  const backend: BridgeBackend = {
    listConnections: () => Promise.resolve([{ id: 'test', name: 'pg-compat', kind: 'compat', active: true }]),
    listSchemas: () => metadata.listSchemas(),
    listTables: async (schema) => (await metadata.listTables(schema)).map((t) => ({ name: t.name, kind: t.kind })),
    listColumns: (schema, table) => metadata.listColumns(schema, table),
    executeReadOnly: async (sql, maxRows) => {
      const wrapped = `BEGIN TRANSACTION READ ONLY;\n${sql}\n;COMMIT;`;
      let out;
      try {
        out = await queryAll(transport, wrapped);
      } catch (err) {
        await queryAll(transport, 'ROLLBACK').catch(() => undefined);
        throw err;
      }
      const { columns, rows } = out;
      const truncated = rows.length > maxRows;
      const capped = truncated ? rows.slice(0, maxRows) : rows;
      // pii-safe-mode, exactly as ExtensionBridgeBackend applies it: the agent
      // must never receive raw PII (here: any column named like 'email').
      const masked = maskRows(columns, capped, { enabled: true, patterns: ['email'] });
      return {
        columns: columns.map((c) => ({ name: c.name, typeName: c.typeName })),
        rows: masked,
        rowCount: rows.length,
        truncated,
      };
    },
  };

  // The bridge now authenticates its child (S-09); the E2E must present it too.
  const BRIDGE_TOKEN = 'e2e-token-0123456789abcdef';
  const bridge = new BridgeServer(backend, BRIDGE_TOKEN);
  const client = new Client({ name: 'redlens-e2e', version: '0.0.1' });
  const serverBundle = path.resolve(__dirname, '../out-integration/mcp-server-under-test.cjs');

  beforeAll(async () => {
    await transport.connect();
    const setup = await transport.execute(`
      DROP TABLE IF EXISTS public.mcp_e2e;
      CREATE TABLE public.mcp_e2e (id int4 NOT NULL, label varchar(30), email varchar(50));
      INSERT INTO public.mcp_e2e VALUES (1, 'alpha', 'a@x.com'), (2, 'beta', 'b@x.com'), (3, 'gamma', 'c@x.com');
    `);
    transport.releaseResult(setup);

    await build({
      entryPoints: { 'mcp-server-under-test': path.resolve(__dirname, '../mcp-server/index.ts') },
      outdir: path.resolve(__dirname, '../out-integration'),
      outExtension: { '.js': '.cjs' },
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      logLevel: 'silent',
    });

    const port = await bridge.start();
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [serverBundle],
        env: { ...process.env, REDLENS_BRIDGE_PORT: String(port), REDLENS_BRIDGE_TOKEN: BRIDGE_TOKEN } as Record<string, string>,
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await client.close().catch(() => undefined);
    await bridge.stop();
    const cleanup = await transport.execute('DROP TABLE IF EXISTS public.mcp_e2e');
    transport.releaseResult(cleanup);
    await transport.dispose();
  });

  it('lists the 6 expected tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'execute_query',
      'explain_query',
      'list_columns',
      'list_connections',
      'list_schemas',
      'list_tables',
    ]);
  });

  it('list_schemas / list_tables / list_columns walk real metadata', async () => {
    const schemas = await callJson(client, 'list_schemas', {});
    expect(schemas).toContain('public');

    const tables = (await callJson(client, 'list_tables', { schema: 'public' })) as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('mcp_e2e');

    const columns = (await callJson(client, 'list_columns', { schema: 'public', table: 'mcp_e2e' })) as {
      name: string;
    }[];
    expect(columns.map((c) => c.name)).toEqual(['id', 'label', 'email']);
  });

  it('execute_query runs read-only SQL and returns rows', async () => {
    const result = (await callJson(client, 'execute_query', {
      sql: 'SELECT id, label FROM public.mcp_e2e ORDER BY id',
    })) as { rows: unknown[][]; rowCount: number };
    expect(result.rowCount).toBe(3);
    expect(result.rows[0]).toEqual([1, 'alpha']);
  });

  it('pii-safe-mode masks PII columns before the agent sees them', async () => {
    const result = (await callJson(client, 'execute_query', {
      sql: 'SELECT id, email FROM public.mcp_e2e ORDER BY id',
    })) as { rows: unknown[][] };
    // id is untouched, email is masked — no raw address reaches the LLM.
    expect(result.rows[0]).toEqual([1, MASK_TOKEN]);
    expect(JSON.stringify(result.rows)).not.toContain('@x.com');
  });

  it('rejects writes at the parser layer', async () => {
    const res = await client.callTool({ name: 'execute_query', arguments: { sql: "INSERT INTO public.mcp_e2e VALUES (9, 'x')" } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/rejected|SELECT/);
  });

  it('engine READ ONLY blocks writes even if smuggled as first keyword lookalike', async () => {
    // WITH ... INSERT would pass a naive first-keyword check; the engine kills it.
    const res = await client.callTool({
      name: 'execute_query',
      arguments: { sql: "WITH x AS (SELECT 1) INSERT INTO public.mcp_e2e SELECT 9, 'x' FROM x" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/read-only|cannot execute/i);
  });

  it('explain_query returns a plan', async () => {
    const result = (await callJson(client, 'explain_query', { sql: 'SELECT * FROM public.mcp_e2e' })) as {
      rows: unknown[][];
    };
    expect(JSON.stringify(result.rows)).toMatch(/Seq Scan|Scan/);
  });
});

function textOf(res: unknown): string {
  const content = (res as { content?: { type: string; text?: string }[] }).content;
  return content?.map((c) => c.text ?? '').join('\n') ?? '';
}

async function callJson(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError === true) {
    throw new Error(`tool ${name} errored: ${textOf(res)}`);
  }
  return JSON.parse(textOf(res));
}
