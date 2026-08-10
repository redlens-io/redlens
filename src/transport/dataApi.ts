import {
  RedshiftDataClient,
  ExecuteStatementCommand,
  DescribeStatementCommand,
  GetStatementResultCommand,
  CancelStatementCommand,
  type ColumnMetadata,
  type Field,
} from '@aws-sdk/client-redshift-data';
import { categorizeTypeName, parseValue } from './typeParser';
import type { BufferedTransport, ColumnInfo, ExecuteOptions, ExecutionSummary, QueryResultPage } from './types';

/**
 * Redshift Data API transport (PLAN §5.1): HTTPS + IAM, zero network config,
 * works with provisioned clusters AND serverless workgroups. Async by nature —
 * ExecuteStatement returns an id, then we poll DescribeStatement with backoff
 * until FINISHED. Values arrive JDBC-style (strings) → re-parsed via typeParser.
 *
 * The AWS SDK client is injected so the polling/paging logic is unit-tested
 * against a fake without touching AWS (real validation is Fase B).
 */
export interface DataApiTarget {
  /** Exactly one of clusterIdentifier (provisioned) or workgroupName (serverless). */
  clusterIdentifier?: string;
  workgroupName?: string;
  database: string;
  dbUser?: string;
  secretArn?: string;
  region: string;
}

export interface DataApiDeps {
  client: Pick<
    RedshiftDataClient,
    'send'
  >;
  /** Injected sleep so tests run instantly. */
  sleep?: (ms: number) => Promise<void>;
}

interface BufferedResult {
  columns: ColumnInfo[];
  rows: unknown[][];
  durationMs: number;
  command: string;
}

const POLL_BASE_MS = 100;
const POLL_MAX_MS = 2000;
const TERMINAL = new Set(['FINISHED', 'FAILED', 'ABORTED']);

export class DataApiTransport implements BufferedTransport {
  readonly kind = 'data-api' as const;

  private readonly results = new Map<string, BufferedResult>();
  private counter = 0;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly target: DataApiTarget,
    private readonly deps: DataApiDeps,
  ) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  connect(): Promise<void> {
    if (this.target.clusterIdentifier === undefined && this.target.workgroupName === undefined) {
      return Promise.reject(new Error('Data API needs a cluster identifier or a serverless workgroup name'));
    }
    return Promise.resolve();
  }

  async execute(sql: string, _options?: ExecuteOptions): Promise<string> {
    const started = Date.now();
    const submit = await this.deps.client.send(
      new ExecuteStatementCommand({
        Sql: sql,
        Database: this.target.database,
        ClusterIdentifier: this.target.clusterIdentifier,
        WorkgroupName: this.target.workgroupName,
        DbUser: this.target.dbUser,
        SecretArn: this.target.secretArn,
      }) as never,
    );
    const statementId = (submit as { Id?: string }).Id;
    if (statementId === undefined) {
      throw new Error('Data API did not return a statement id');
    }

    const status = await this.pollUntilDone(statementId);
    if (status.state === 'FAILED' || status.state === 'ABORTED') {
      throw new Error(`Data API statement ${status.state}: ${status.error ?? 'no detail'}`);
    }

    const { columns, rows } = status.hasResult
      ? await this.fetchAllRows(statementId)
      : { columns: [] as ColumnInfo[], rows: [] as unknown[][] };

    const id = `dataapi-${++this.counter}`;
    this.results.set(id, { columns, rows, durationMs: Date.now() - started, command: firstKeyword(sql) });
    return id;
  }

  private async pollUntilDone(statementId: string): Promise<{ state: string; error?: string; hasResult: boolean }> {
    let delay = POLL_BASE_MS;
    for (;;) {
      const describe = (await this.deps.client.send(new DescribeStatementCommand({ Id: statementId }) as never)) as {
        Status?: string;
        Error?: string;
        HasResultSet?: boolean;
      };
      const state = describe.Status ?? 'UNKNOWN';
      if (TERMINAL.has(state)) {
        return { state, error: describe.Error, hasResult: describe.HasResultSet === true };
      }
      await this.sleep(delay);
      delay = Math.min(delay * 2, POLL_MAX_MS);
    }
  }

  private async fetchAllRows(statementId: string): Promise<{ columns: ColumnInfo[]; rows: unknown[][] }> {
    const rows: unknown[][] = [];
    let columns: ColumnInfo[] = [];
    let nextToken: string | undefined;
    do {
      const page = (await this.deps.client.send(
        new GetStatementResultCommand({ Id: statementId, NextToken: nextToken }) as never,
      )) as { ColumnMetadata?: ColumnMetadata[]; Records?: Field[][]; NextToken?: string };
      if (columns.length === 0 && page.ColumnMetadata !== undefined) {
        columns = page.ColumnMetadata.map((c) => ({
          name: c.name ?? c.label ?? '?',
          typeName: c.typeName ?? 'varchar',
          nullable: c.nullable !== 0,
        }));
      }
      for (const record of page.Records ?? []) {
        rows.push(record.map((field, i) => decodeField(field, columns[i]?.typeName ?? 'varchar')));
      }
      nextToken = page.NextToken;
    } while (nextToken !== undefined);
    return { columns, rows };
  }

  resultSetCount(_executionId: string): number {
    return 1;
  }

  fetchPage(executionId: string, _nextToken?: string, _setIndex = 0): Promise<QueryResultPage> {
    const result = this.require(executionId);
    return Promise.resolve({ columns: result.columns, rows: result.rows, totalRows: result.rows.length });
  }

  getSummary(executionId: string, _setIndex = 0): ExecutionSummary {
    const r = this.require(executionId);
    return { rowCount: r.rows.length, durationMs: r.durationMs, truncated: false, command: r.command };
  }

  getCellValue(executionId: string, _setIndex: number, rowIndex: number, columnIndex: number): unknown {
    return this.require(executionId).rows[rowIndex]?.[columnIndex] ?? null;
  }

  releaseResult(executionId: string): void {
    this.results.delete(executionId);
  }

  async cancel(executionId: string): Promise<void> {
    // Best-effort: we cancel by statement id only while a statement is in
    // flight; buffered results have no live statement. Kept for the contract.
    void executionId;
    return Promise.resolve();
  }

  async cancelStatement(statementId: string): Promise<void> {
    await this.deps.client.send(new CancelStatementCommand({ Id: statementId }) as never);
  }

  dispose(): Promise<void> {
    this.results.clear();
    return Promise.resolve();
  }

  private require(executionId: string): BufferedResult {
    const r = this.results.get(executionId);
    if (r === undefined) {
      throw new Error(`unknown or released execution id: ${executionId}`);
    }
    return r;
  }
}

/** Data API returns each value as a typed Field union; normalize to a JS value. */
export function decodeField(field: Field, typeName: string): unknown {
  if (field.isNull === true) {
    return null;
  }
  if (field.stringValue !== undefined) {
    return parseValue(field.stringValue, categorizeTypeName(typeName));
  }
  if (field.longValue !== undefined) {
    return field.longValue;
  }
  if (field.doubleValue !== undefined) {
    return field.doubleValue;
  }
  if (field.booleanValue !== undefined) {
    return field.booleanValue;
  }
  if (field.blobValue !== undefined) {
    return field.blobValue;
  }
  return null;
}

function firstKeyword(sql: string): string {
  return /^\s*([A-Za-z]+)/.exec(sql)?.[1]?.toUpperCase() ?? 'SELECT';
}
