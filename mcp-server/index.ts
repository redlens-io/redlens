/**
 * RedLens embedded MCP server (stdio). Launched by VS Code via the extension's
 * McpServerDefinitionProvider with ELECTRON_RUN_AS_NODE=1 — no system Node
 * required. All data access goes through the extension's localhost bridge
 * (REDLENS_BRIDGE_PORT): this process never sees credentials.
 *
 * stdio rule: stdout is the JSON-RPC stream — log via console.error ONLY.
 */
import * as net from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { buildServerInfo, injectedVersion } from './serverInfo';

const BRIDGE_PORT = Number.parseInt(process.env.REDLENS_BRIDGE_PORT ?? '', 10);
// Proves to the bridge that this really is the child the extension spawned
// (S-09). Handed over in the environment, never on disk or on the wire.
const BRIDGE_TOKEN = process.env.REDLENS_BRIDGE_TOKEN ?? '';
if (Number.isNaN(BRIDGE_PORT)) {
  console.error('REDLENS_BRIDGE_PORT is not set — this server must be launched by the RedLens extension.');
  process.exit(1);
}

// ---------- bridge client (ndjson over localhost) ----------

let socket: net.Socket | undefined;
let buffer = '';
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function ensureSocket(): Promise<net.Socket> {
  if (socket !== undefined && !socket.destroyed) {
    return Promise.resolve(socket);
  }
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: '127.0.0.1', port: BRIDGE_PORT }, () => {
      socket = s;
      resolve(s);
    });
    s.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim().length > 0) {
          try {
            const msg = JSON.parse(line) as { id: number; result?: unknown; error?: string };
            const waiter = pending.get(msg.id);
            if (waiter !== undefined) {
              pending.delete(msg.id);
              if (msg.error !== undefined) {
                waiter.reject(new Error(msg.error));
              } else {
                waiter.resolve(msg.result);
              }
            }
          } catch (err) {
            console.error('bridge: bad frame', err);
          }
        }
        newline = buffer.indexOf('\n');
      }
    });
    s.on('error', (err) => {
      for (const waiter of pending.values()) {
        waiter.reject(err instanceof Error ? err : new Error(String(err)));
      }
      pending.clear();
      socket = undefined;
      reject(err);
    });
    s.on('close', () => {
      socket = undefined;
    });
  });
}

async function bridgeCall<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const s = await ensureSocket();
  const id = nextId++;
  const payload = `${JSON.stringify({ id, method, params })}\n`;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (v) => resolve(v as T), reject });
    s.write(payload);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`bridge call timed out: ${method}`));
      }
    }, 120_000);
  });
}

// ---------- MCP surface ----------

function asText(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function asError(err: unknown): { content: { type: 'text'; text: string }[]; isError: true } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

const server = new McpServer(buildServerInfo(injectedVersion()));

server.registerTool(
  'list_connections',
  { description: 'List the Redshift/Postgres connection profiles configured in RedLens and which one is active.' },
  async () => {
    try {
      return asText(await bridgeCall('listConnections'));
    } catch (err) {
      return asError(err);
    }
  },
);

server.registerTool(
  'list_schemas',
  { description: 'List schemas of the active RedLens connection (includes external/Spectrum schemas on Redshift).' },
  async () => {
    try {
      return asText(await bridgeCall('listSchemas'));
    } catch (err) {
      return asError(err);
    }
  },
);

server.registerTool(
  'list_tables',
  {
    description: 'List tables/views of a schema on the active RedLens connection.',
    inputSchema: { schema: z.string().describe('Schema name, e.g. public or tickit') },
  },
  async ({ schema }) => {
    try {
      return asText(await bridgeCall('listTables', { schema }));
    } catch (err) {
      return asError(err);
    }
  },
);

server.registerTool(
  'list_columns',
  {
    description: 'List columns (name, type, nullability) of a table on the active RedLens connection.',
    inputSchema: {
      schema: z.string().describe('Schema name'),
      table: z.string().describe('Table or view name'),
    },
  },
  async ({ schema, table }) => {
    try {
      return asText(await bridgeCall('listColumns', { schema, table }));
    } catch (err) {
      return asError(err);
    }
  },
);

server.registerTool(
  'execute_query',
  {
    description:
      'Run a READ-ONLY SQL statement (SELECT/WITH/SHOW/EXPLAIN) on the active RedLens connection. Writes are rejected by parser AND by an engine-level read-only transaction. Results are truncated to maxRows (default 500).',
    inputSchema: {
      sql: z.string().describe('A single read-only SQL statement'),
      maxRows: z.number().int().positive().max(5000).optional().describe('Row cap for the response (default 500)'),
    },
  },
  async ({ sql, maxRows }) => {
    try {
      return asText(await bridgeCall('executeReadOnly', { sql, maxRows }));
    } catch (err) {
      return asError(err);
    }
  },
);

server.registerTool(
  'explain_query',
  {
    description: 'Get the execution plan (EXPLAIN) for a SQL statement on the active RedLens connection.',
    inputSchema: { sql: z.string().describe('The SQL to explain (do not include the EXPLAIN keyword)') },
  },
  async ({ sql }) => {
    try {
      return asText(await bridgeCall('executeReadOnly', { sql: `EXPLAIN ${sql}` }));
    } catch (err) {
      return asError(err);
    }
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`redlens-redshift MCP server up (bridge port ${BRIDGE_PORT})`);
}

void main();
