import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgWireTransport } from '../src/transport/pgWire';
import { queryAll } from '../src/query/collect';
import { parsePlan } from '../src/explain/planParser';
import { analyzePlan } from '../src/explain/planWarnings';

const HOST = process.env.REDLENS_PG_HOST;

describe.runIf(Boolean(HOST))('EXPLAIN visualizer (live plan from pg-compat)', () => {
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

  it('parses a real EXPLAIN of a join over the seeded tickit tables', async () => {
    const { rows } = await queryAll(
      transport,
      'EXPLAIN SELECT e.eventname, sum(s.pricepaid) FROM tickit.sales s JOIN tickit.event e ON e.eventid = s.eventid GROUP BY e.eventname',
    );
    const lines = rows.map((r) => String(r[0] ?? ''));
    expect(lines.length).toBeGreaterThan(0);

    const nodes = parsePlan(lines);
    expect(nodes.length).toBeGreaterThan(0);
    // A join plan must contain at least one scan and one join/aggregate node.
    expect(nodes.some((n) => /Scan/.test(n.text))).toBe(true);
    expect(nodes.some((n) => /Join|Aggregate|Hash/.test(n.text))).toBe(true);
    // Cost parsing worked on at least the root.
    expect(nodes[0]?.cost).toBeDefined();

    // analyze must not throw on real plans (may or may not warn on tiny tables).
    expect(() => analyzePlan(nodes)).not.toThrow();
  });

  it('EXPLAIN ANALYZE yields actual per-node timing (explain-analyze-flamegraph)', async () => {
    const { rows } = await queryAll(transport, 'EXPLAIN ANALYZE SELECT count(*) FROM tickit.sales');
    const nodes = parsePlan(rows.map((r) => String(r[0] ?? '')));
    expect(nodes.length).toBeGreaterThan(0);
    // At least one node should carry an actual-time measurement.
    expect(nodes.some((n) => n.actualMs !== undefined && n.actualMs >= 0)).toBe(true);
  });
});
