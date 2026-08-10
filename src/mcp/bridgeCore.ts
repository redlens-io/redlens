import * as net from 'node:net';
import { checkReadOnlySql } from './sqlGuard';

/**
 * vscode-free core of the extension↔MCP bridge (unit/E2E-testable):
 * a localhost ndjson-RPC server. The MCP child process (dist/mcp-server.js)
 * is the only intended client; credentials never leave the extension side
 * (vscode-mssql socket-bridge pattern, PLAN §5.4).
 */

export interface BridgeBackend {
  listConnections(): Promise<{ id: string; name: string; kind: string; active: boolean }[]>;
  listSchemas(): Promise<string[]>;
  listTables(schema: string): Promise<{ name: string; kind: string }[]>;
  listColumns(schema: string, table: string): Promise<{ name: string; typeName: string; nullable: boolean }[]>;
  /** Executes ALREADY-GUARDED sql; implementations add the engine-level READ ONLY wrapper. */
  executeReadOnly(sql: string, maxRows: number): Promise<{
    columns: { name: string; typeName: string }[];
    rows: unknown[][];
    rowCount: number;
    truncated: boolean;
  }>;
}

interface RpcRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  /** Shared secret proving the caller is our own child process (S-09). */
  token?: string;
}

export const DEFAULT_MAX_ROWS = 500;

/** Length-safe, constant-time-ish comparison for the bridge token. */
export function tokenMatches(expected: string, presented: unknown): boolean {
  if (typeof presented !== 'string' || presented.length !== expected.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ presented.charCodeAt(i);
  }
  return diff === 0;
}

export class BridgeServer {
  private server: net.Server | undefined;
  private port: number | undefined;

  /**
   * @param token Shared secret the MCP child must present on every request
   *   (S-09). Binding to 127.0.0.1 keeps the bridge off the network, but it does
   *   nothing about the machine itself: any local process — another extension, a
   *   package postinstall script, malware — can enumerate localhost ports and
   *   talk to an unauthenticated one. Without this it would inherit the user's
   *   live warehouse session; the read-only guard and PII masking bound what it
   *   could do, but nothing stopped it connecting.
   */
  constructor(private readonly backend: BridgeBackend, private readonly token: string) {}

  async start(): Promise<number> {
    if (this.port !== undefined) {
      return this.port;
    }
    const server = net.createServer((socket) => {
      let buffer = '';
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (line.trim().length > 0) {
            void this.handleLine(line, socket);
          }
          newline = buffer.indexOf('\n');
        }
      });
      socket.on('error', () => socket.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    this.server = server;
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('bridge: could not determine listen port');
    }
    this.port = address.port;
    return this.port;
  }

  private async handleLine(line: string, socket: net.Socket): Promise<void> {
    let request: RpcRequest;
    try {
      request = JSON.parse(line) as RpcRequest;
    } catch {
      socket.write(`${JSON.stringify({ id: -1, error: 'invalid JSON' })}\n`);
      return;
    }
    try {
      const result = await this.dispatch(request);
      socket.write(`${JSON.stringify({ id: request.id, result })}\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      socket.write(`${JSON.stringify({ id: request.id, error: message })}\n`);
    }
  }

  private async dispatch(request: RpcRequest): Promise<unknown> {
    const p = request.params ?? {};
    switch (request.method) {
      case 'ping':
        return { ok: true };
      case 'listConnections':
        return this.backend.listConnections();
      case 'listSchemas':
        return this.backend.listSchemas();
      case 'listTables':
        return this.backend.listTables(String(p.schema ?? ''));
      case 'listColumns':
        return this.backend.listColumns(String(p.schema ?? ''), String(p.table ?? ''));
      case 'executeReadOnly': {
        const sql = String(p.sql ?? '');
        const verdict = checkReadOnlySql(sql);
        if (!verdict.ok) {
          throw new Error(`rejected: ${verdict.reason}`);
        }
        const maxRows = typeof p.maxRows === 'number' && p.maxRows > 0 ? Math.min(p.maxRows, 5000) : DEFAULT_MAX_ROWS;
        return this.backend.executeReadOnly(sql, maxRows);
      }
      default:
        throw new Error(`unknown method: ${request.method}`);
    }
  }

  getPort(): number | undefined {
    return this.port;
  }

  async stop(): Promise<void> {
    if (this.server !== undefined) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
      this.server = undefined;
      this.port = undefined;
    }
  }
}
