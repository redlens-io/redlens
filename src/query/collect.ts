import type { BufferedTransport, QueryResultPage } from '../transport/types';

export interface CollectedResult {
  columns: QueryResultPage['columns'];
  rows: unknown[][];
}

/**
 * Runs a statement and drains its meaningful result set — for small internal
 * result sets (metadata, MCP execute). With multi-statement wrappers like
 * `BEGIN TRANSACTION READ ONLY; <select>; COMMIT;` the SELECT is not set 0, so
 * this picks the LAST result set that actually has columns.
 */
export async function queryAll(transport: BufferedTransport, sql: string): Promise<CollectedResult> {
  const id = await transport.execute(sql);
  try {
    const setCount = transport.resultSetCount(id);
    let chosen: CollectedResult = { columns: [], rows: [] };
    for (let s = 0; s < setCount; s++) {
      const rows: unknown[][] = [];
      let columns: QueryResultPage['columns'] = [];
      let token: string | undefined;
      do {
        const page = await transport.fetchPage(id, token, s);
        columns = page.columns;
        rows.push(...page.rows);
        token = page.nextToken;
      } while (token !== undefined);
      if (columns.length > 0) {
        chosen = { columns, rows };
      }
    }
    return chosen;
  } finally {
    transport.releaseResult(id);
  }
}
