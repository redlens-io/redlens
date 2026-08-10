/**
 * Connection-agnostic contract every Redshift transport implements (PLAN §5.1).
 *
 * Implementations arrive in Fase 1:
 *  - DataApiTransport  — @aws-sdk/client-redshift-data (default; zero network config)
 *  - PgWireTransport   — pg against port 5439, optionally through SshTunnel (bastion)
 */
export type TransportKind = 'data-api' | 'direct' | 'direct+ssh' | 'demo';

export interface ColumnInfo {
  name: string;
  /** Redshift type name as reported by the engine (e.g. int8, varchar, super). */
  typeName: string;
  nullable: boolean;
}

export interface QueryResultPage {
  columns: ColumnInfo[];
  rows: unknown[][];
  /** Present when more pages exist. */
  nextToken?: string;
  /** Total rows when the transport knows it upfront (Data API: TotalNumRows). */
  totalRows?: number;
}

export interface ExecuteOptions {
  database?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface RedshiftTransport {
  readonly kind: TransportKind;
  connect(): Promise<void>;
  /** Submits SQL and resolves to a transport-scoped execution id. */
  execute(sql: string, options?: ExecuteOptions): Promise<string>;
  /** Page of one result set (setIndex defaults to 0 for single-set callers). */
  fetchPage(executionId: string, nextToken?: string, setIndex?: number): Promise<QueryResultPage>;
  cancel(executionId: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface ExecutionSummary {
  rowCount: number;
  durationMs: number;
  truncated: boolean;
  command: string;
}

/** What the UI layer needs beyond the base contract (results panel metadata). */
export interface BufferedTransport extends RedshiftTransport {
  /** Number of result sets a multi-statement execution produced (≥1). */
  resultSetCount(executionId: string): number;
  getSummary(executionId: string, setIndex?: number): ExecutionSummary;
  releaseResult(executionId: string): void;
  /** Full (untruncated) value of one cell — for load-full-cell / value viewers. */
  getCellValue(executionId: string, setIndex: number, rowIndex: number, columnIndex: number): unknown;
}
