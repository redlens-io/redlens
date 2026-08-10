import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgWireTransport } from '../src/transport/pgWire';

/**
 * Live transport test against the pg-compat container (PLAN §7.1 Capa 1).
 * Runs only when REDLENS_PG_HOST is set — scripts/remote/test.sh sets it via
 * docker host-gateway so this always runs in the VM Lab loop, and never in
 * environments without the database.
 */
const HOST = process.env.REDLENS_PG_HOST;

describe.runIf(Boolean(HOST))('PgWireTransport (live against pg-compat)', () => {
  const transport = new PgWireTransport({
    host: HOST ?? '',
    port: Number.parseInt(process.env.REDLENS_PG_PORT ?? '15439', 10),
    database: process.env.REDLENS_PG_DB ?? 'redlens',
    user: process.env.REDLENS_PG_USER ?? 'redlens',
    password: process.env.REDLENS_PG_PASSWORD ?? 'redlens',
    ssl: false,
  });

  beforeAll(async () => {
    await transport.connect();
  });

  afterAll(async () => {
    await transport.dispose();
  });

  it('executes a query and pages results with correct types', async () => {
    const id = await transport.execute('SELECT generate_series(1, 1203) AS n, now() AS ts');
    const page1 = await transport.fetchPage(id);
    expect(page1.columns.map((c) => c.name)).toEqual(['n', 'ts']);
    expect(page1.columns[0]?.typeName).toBe('int4');
    expect(page1.columns[1]?.typeName).toBe('timestamptz');
    expect(page1.rows).toHaveLength(500);
    expect(page1.totalRows).toBe(1203);
    expect(page1.nextToken).toBeDefined();

    const page3 = await transport.fetchPage(id, '1000');
    expect(page3.rows).toHaveLength(203);
    expect(page3.nextToken).toBeUndefined();

    const summary = transport.getSummary(id);
    expect(summary.rowCount).toBe(1203);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    expect(summary.truncated).toBe(false);
    transport.releaseResult(id);
  });

  it('keeps every result set of a multi-statement script (multiple-result-sets)', async () => {
    const id = await transport.execute('SELECT 1 AS a; SELECT 2 AS b, 3 AS c');
    expect(transport.resultSetCount(id)).toBe(2);

    const set0 = await transport.fetchPage(id, undefined, 0);
    expect(set0.columns.map((c) => c.name)).toEqual(['a']);
    expect(set0.rows).toEqual([[1]]);

    const set1 = await transport.fetchPage(id, undefined, 1);
    expect(set1.columns.map((c) => c.name)).toEqual(['b', 'c']);
    expect(set1.rows).toEqual([[2, 3]]);

    // getCellValue returns the full value of a specific cell (load-full-cell API).
    expect(transport.getCellValue(id, 1, 0, 1)).toBe(3);
    transport.releaseResult(id);
  });

  it('reports SQL errors with the server message', async () => {
    await expect(transport.execute('SELECT * FROM table_that_does_not_exist')).rejects.toThrow(/table_that_does_not_exist/);
  });
});
