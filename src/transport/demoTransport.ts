import { FIXTURE_TABLES, fixtureColumnsToColumnInfo, type FixtureTable } from '../demo/fixtures';
import { slicePage } from '../query/paging';
import type { BufferedTransport, ExecuteOptions, ExecutionSummary, QueryResultPage } from './types';

interface DemoResult {
  table: FixtureTable;
  rows: unknown[][];
  durationMs: number;
}

const PREVIEW_RE =
  /^\s*select\s+\*\s+from\s+(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*\.\s*(?:"([^"]+)"|([A-Za-z_][\w$]*))\s*(?:limit\s+(\d+))?\s*;?\s*$/i;

/**
 * Demo mode (PLAN §5.1): serves recorded fixtures so anyone can try RedLens
 * with zero credentials. Honest scope: table previews + SELECT 1; arbitrary
 * SQL requires a real database and says so in plain language.
 */
export class DemoTransport implements BufferedTransport {
  readonly kind = 'demo' as const;

  private readonly results = new Map<string, DemoResult>();
  private counter = 0;

  connect(): Promise<void> {
    return Promise.resolve();
  }

  execute(sql: string, _options?: ExecuteOptions): Promise<string> {
    const trimmed = sql.trim();
    if (/^select\s+1\s*;?$/i.test(trimmed)) {
      return Promise.resolve(this.store(SELECT_ONE, SELECT_ONE.rows));
    }
    const match = PREVIEW_RE.exec(trimmed);
    if (match !== null) {
      const schema = match[1] ?? match[2] ?? '';
      const name = match[3] ?? match[4] ?? '';
      const limit = match[5] !== undefined ? Number.parseInt(match[5], 10) : 100;
      const table = FIXTURE_TABLES.find((t) => t.schema === schema && t.name === name);
      if (table === undefined) {
        return Promise.reject(new Error(`demo table not found: ${schema}.${name}`));
      }
      return Promise.resolve(this.store(table, table.rows.slice(0, limit)));
    }
    return Promise.reject(
      new Error(
        'Demo mode runs table previews — click a table in the RedLens explorer. Connect to a real database to run arbitrary SQL.',
      ),
    );
  }

  resultSetCount(_executionId: string): number {
    return 1;
  }

  fetchPage(executionId: string, nextToken?: string, _setIndex = 0): Promise<QueryResultPage> {
    const result = this.require(executionId);
    const page = slicePage(result.rows, nextToken);
    return Promise.resolve({
      columns: fixtureColumnsToColumnInfo(result.table),
      rows: page.items,
      nextToken: page.nextToken,
      totalRows: result.rows.length,
    });
  }

  getSummary(executionId: string, _setIndex = 0): ExecutionSummary {
    const result = this.require(executionId);
    return { rowCount: result.rows.length, durationMs: result.durationMs, truncated: false, command: 'SELECT' };
  }

  getCellValue(executionId: string, _setIndex: number, rowIndex: number, columnIndex: number): unknown {
    return this.require(executionId).rows[rowIndex]?.[columnIndex] ?? null;
  }

  releaseResult(executionId: string): void {
    this.results.delete(executionId);
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    this.results.clear();
    return Promise.resolve();
  }

  private store(table: FixtureTable, rows: unknown[][]): string {
    const id = `demo-${++this.counter}`;
    this.results.set(id, { table, rows, durationMs: 1 });
    return id;
  }

  private require(executionId: string): DemoResult {
    const result = this.results.get(executionId);
    if (result === undefined) {
      throw new Error(`unknown or released execution id: ${executionId}`);
    }
    return result;
  }
}

const SELECT_ONE: FixtureTable = {
  schema: 'demo',
  name: 'select_one',
  kind: 'table',
  columns: [{ name: '?column?', typeName: 'int4', nullable: false }],
  rows: [[1]],
};
