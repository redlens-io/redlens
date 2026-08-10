import { Client, type QueryArrayResult } from 'pg';
import { typeNameForOid } from './oidTypes';
import { slicePage } from '../query/paging';
import type { BufferedTransport, ColumnInfo, ExecuteOptions, QueryResultPage } from './types';

export interface PgWireConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** verify-full with the Amazon Trust bundle lands in Fase B; compat mode runs without TLS. */
  ssl?: boolean;
  /**
   * Opt out of TLS certificate verification (S-08). Off by default: `ssl: true`
   * alone used to mean "encrypt but trust anybody", which gives confidentiality
   * against a passive observer and nothing at all against an active one — the
   * attacker just presents their own certificate and reads the password and
   * every result. Only set this when connecting to something with a private CA
   * you have consciously decided to trust.
   */
  sslInsecure?: boolean;
  connectTimeoutMs?: number;
}

/** Node's TLS codes for "the certificate did not check out" (S-08). */
const TLS_VERIFY_CODES = new Set([
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/**
 * Certificate verification is on by default now, so a connection that used to
 * succeed by trusting anything may start failing. Say what happened and what the
 * two real options are, instead of surfacing a bare OpenSSL code — a user who
 * cannot tell "your warehouse is misconfigured" from "someone is intercepting
 * you" will just look for the switch that makes the error go away.
 */
export function explainTlsFailure(err: unknown): Error {
  const code = (err as { code?: string } | null)?.code;
  if (code === undefined || !TLS_VERIFY_CODES.has(code)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  return new Error(
    `TLS certificate verification failed (${code}). RedLens verifies the server certificate, ` +
      'so an intercepted connection fails instead of silently succeeding. Either fix the trust chain ' +
      '(use the endpoint name the certificate was issued for, or install your private CA), or — only ' +
      'if you have decided this network is trustworthy — set "sslInsecure" on this connection profile ' +
      'to accept any certificate.',
  );
}

interface BufferedResult {
  columns: ColumnInfo[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
  truncated: boolean;
  command: string;
}

/**
 * Row-buffer cap for Fase A1: node-postgres materializes result sets in
 * memory; we keep at most this many rows and flag truncation. Cursor-based
 * streaming replaces this when the virtualized grid lands (A2).
 */
export const MAX_BUFFERED_ROWS = 50_000;

let executionCounter = 0;

export class PgWireTransport implements BufferedTransport {
  readonly kind = 'direct' as const;

  private client: Client | undefined;
  /** One execution id → one or more result sets (multi-statement scripts). */
  private readonly results = new Map<string, BufferedResult[]>();
  private backendPid: number | undefined;

  constructor(private readonly config: PgWireConfig) {}

  async connect(): Promise<void> {
    const client = new Client({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: this.config.sslInsecure !== true } : undefined,
      connectionTimeoutMillis: this.config.connectTimeoutMs ?? 8000,
      application_name: 'RedLens',
    });
    try {
      await client.connect();
    } catch (err) {
      throw explainTlsFailure(err);
    }
    this.client = client;
    // processID lets cancel() target this session from a side connection.
    this.backendPid = (client as unknown as { processID?: number }).processID;
  }

  async execute(sql: string, _options?: ExecuteOptions): Promise<string> {
    const client = this.requireClient();
    const started = Date.now();
    let raw;
    try {
      raw = await client.query({ text: sql, rowMode: 'array' });
    } catch (err) {
      // A failed statement inside a multi-statement transaction (e.g. a grid
      // commit whose INSERT violates a constraint) leaves the session in an
      // "aborted transaction" state: Postgres never reaches the trailing
      // COMMIT, so every later query fails until a ROLLBACK. Recover the
      // connection best-effort, then rethrow the ORIGINAL error. No data was
      // committed — atomicity is preserved.
      try {
        await client.query('ROLLBACK');
      } catch {
        /* no open transaction, or the connection is gone — nothing to recover */
      }
      throw err;
    }
    const durationMs = Date.now() - started;

    // Multiple statements in one text → node-postgres resolves an array of
    // results (not modeled by @types/pg, hence the cast). Keep EVERY set so the
    // grid can show one tab per statement (multiple-result-sets).
    const results: QueryArrayResult[] = Array.isArray(raw) ? (raw as unknown as QueryArrayResult[]) : [raw];
    const sets: BufferedResult[] = results.map((r) => {
      const columns: ColumnInfo[] = r.fields.map((f) => ({
        name: f.name,
        typeName: typeNameForOid(f.dataTypeID),
        nullable: true,
      }));
      const allRows = (r.rows ?? []) as unknown[][];
      const truncated = allRows.length > MAX_BUFFERED_ROWS;
      return {
        columns,
        rows: truncated ? allRows.slice(0, MAX_BUFFERED_ROWS) : allRows,
        rowCount: r.rowCount ?? allRows.length,
        durationMs,
        truncated,
        command: r.command,
      };
    });
    if (sets.length === 0) {
      throw new Error('query produced no result');
    }
    const id = `pg-${++executionCounter}`;
    this.results.set(id, sets);
    return id;
  }

  resultSetCount(executionId: string): number {
    return this.requireSets(executionId).length;
  }

  async fetchPage(executionId: string, nextToken?: string, setIndex = 0): Promise<QueryResultPage> {
    const result = this.requireResult(executionId, setIndex);
    const page = slicePage(result.rows, nextToken);
    return {
      columns: result.columns,
      rows: page.items,
      nextToken: page.nextToken,
      totalRows: result.rows.length,
    };
  }

  /** A1 extra beyond the transport contract: summary for the results panel. */
  getSummary(executionId: string, setIndex = 0): { rowCount: number; durationMs: number; truncated: boolean; command: string } {
    const { rowCount, durationMs, truncated, command } = this.requireResult(executionId, setIndex);
    return { rowCount, durationMs, truncated, command };
  }

  getCellValue(executionId: string, setIndex: number, rowIndex: number, columnIndex: number): unknown {
    return this.requireResult(executionId, setIndex).rows[rowIndex]?.[columnIndex] ?? null;
  }

  releaseResult(executionId: string): void {
    this.results.delete(executionId);
  }

  async cancel(_executionId: string): Promise<void> {
    if (this.backendPid === undefined) {
      return;
    }
    // Cancellation must come from a separate session.
    const side = new Client({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: this.config.sslInsecure !== true } : undefined,
      connectionTimeoutMillis: 5000,
      application_name: 'RedLens-cancel',
    });
    try {
      await side.connect();
      await side.query('SELECT pg_cancel_backend($1)', [this.backendPid]);
    } finally {
      await side.end().catch(() => undefined);
    }
  }

  async dispose(): Promise<void> {
    this.results.clear();
    if (this.client !== undefined) {
      await this.client.end().catch(() => undefined);
      this.client = undefined;
    }
  }

  private requireClient(): Client {
    if (this.client === undefined) {
      throw new Error('transport not connected — call connect() first');
    }
    return this.client;
  }

  private requireSets(executionId: string): BufferedResult[] {
    const sets = this.results.get(executionId);
    if (sets === undefined) {
      throw new Error(`unknown or released execution id: ${executionId}`);
    }
    return sets;
  }

  private requireResult(executionId: string, setIndex = 0): BufferedResult {
    const set = this.requireSets(executionId)[setIndex];
    if (set === undefined) {
      throw new Error(`result set ${setIndex} out of range for execution ${executionId}`);
    }
    return set;
  }
}
