import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgWireTransport } from '../src/transport/pgWire';

/**
 * V3 of the pre-publication gate: the pg wire protocol against a REAL Redshift
 * Serverless endpoint, not the pg-compat container.
 *
 * This is the half of V3 that only real Redshift can answer. `pgWire.live.test.ts`
 * proves the transport against Postgres 16, but Postgres is not Redshift: the
 * handshake is TLS-required here, the type OIDs come back from a different
 * catalog, and `generate_series` is leader-node-only — which is exactly why that
 * test cannot simply be pointed at a cluster.
 *
 * Runs only when REDLENS_RS_HOST is set, so it stays skipped in every ordinary
 * run. The environment it needs is ephemeral by design (scripts/aws/provision.sh
 * → teardown.sh the same day), so there is nothing to keep in sync.
 */
const HOST = process.env.REDLENS_RS_HOST;

describe.runIf(Boolean(HOST))('PgWireTransport (live against real Redshift Serverless)', () => {
  const transport = new PgWireTransport({
    host: HOST ?? '',
    port: Number.parseInt(process.env.REDLENS_RS_PORT ?? '5439', 10),
    database: process.env.REDLENS_RS_DB ?? 'dev',
    user: process.env.REDLENS_RS_USER ?? 'redlens_admin',
    password: process.env.REDLENS_RS_PASSWORD ?? '',
    ssl: true,
  });

  beforeAll(async () => {
    await transport.connect();
  }, 60_000);

  afterAll(async () => {
    await transport.dispose();
  });

  it('completes the TLS handshake and reports who it connected as', async () => {
    const id = await transport.execute('select current_user as me, current_database() as db');
    const page = await transport.fetchPage(id);
    expect(page.columns.map((c) => c.name)).toEqual(['me', 'db']);
    expect(page.rows).toHaveLength(1);
    expect(String(page.rows[0]?.[0])).toContain('redlens');
  }, 60_000);

  it('reads tickit over the wire, not through the Data API', async () => {
    const id = await transport.execute('select count(*) as n from sales');
    const page = await transport.fetchPage(id);
    // The public tickit sales file is 172 456 rows; assert it is loaded and
    // non-trivial rather than pinning a number AWS could restate.
    expect(Number(page.rows[0]?.[0])).toBeGreaterThan(100_000);
  }, 60_000);

  it('paginates a real result set', async () => {
    const id = await transport.execute('select salesid, pricepaid from sales order by salesid');
    const page1 = await transport.fetchPage(id);
    expect(page1.rows.length).toBeGreaterThan(0);
    expect(page1.nextToken).toBeDefined();
  }, 60_000);
});
