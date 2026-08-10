import { describe, expect, it } from 'vitest';
import { parsePlan } from '../src/explain/planParser';
import { analyzePlan } from '../src/explain/planWarnings';
import { REDSHIFT_EXPLAIN_FIXTURE, fixtureForSql } from '../src/demo/explainFixtures';

const PG_PLAN = [
  'Hash Join  (cost=1.18..2.63 rows=40 width=32)',
  '  Hash Cond: (s.eventid = e.eventid)',
  '  ->  Seq Scan on sales s  (cost=0.00..1.40 rows=40 width=16)',
  '  ->  Hash  (cost=1.16..1.16 rows=16 width=20)',
  '        ->  Seq Scan on event e  (cost=0.00..1.16 rows=16 width=20)',
];

describe('parsePlan', () => {
  it('builds depth-annotated nodes from Postgres EXPLAIN', () => {
    const nodes = parsePlan(PG_PLAN);
    expect(nodes[0]?.text).toBe('Hash Join');
    expect(nodes[0]?.depth).toBe(0);
    expect(nodes[0]?.cost).toEqual({ startup: 1.18, total: 2.63, rows: 40 });
    // "Hash Cond:" is an attribute of the Hash Join, not a node.
    expect(nodes[0]?.details).toContain('Hash Cond: (s.eventid = e.eventid)');
    const scans = nodes.filter((n) => n.text.startsWith('Seq Scan'));
    expect(scans).toHaveLength(2);
    expect(scans[1]?.depth).toBeGreaterThan(nodes[0]?.depth ?? 0);
  });

  it('parses Redshift XN operators and keeps DS_* markers', () => {
    const nodes = parsePlan(REDSHIFT_EXPLAIN_FIXTURE['tickit.sales JOIN event'] ?? []);
    expect(nodes[0]?.text).toContain('DS_BCAST_INNER');
  });

  it('captures actual time from EXPLAIN ANALYZE (explain-analyze-flamegraph)', () => {
    const nodes = parsePlan([
      'Hash Join  (cost=1.18..2.63 rows=40 width=32) (actual time=0.050..0.120 rows=40 loops=1)',
      '  ->  Seq Scan on sales  (cost=0.00..1.40 rows=40 width=16) (actual time=0.010..0.040 rows=40 loops=2)',
    ]);
    expect(nodes[0]?.actualMs).toBeCloseTo(0.120, 3);
    expect(nodes[1]?.actualMs).toBeCloseTo(0.040 * 2, 3); // end × loops
    expect(nodes[0]?.text).toBe('Hash Join'); // cost + actual stripped
  });
});

describe('analyzePlan', () => {
  it('flags DS_BCAST_INNER as high severity with actionable advice', () => {
    const nodes = parsePlan(REDSHIFT_EXPLAIN_FIXTURE['tickit.sales JOIN event'] ?? []);
    const warnings = analyzePlan(nodes);
    const bcast = warnings.find((w) => w.title.includes('Broadcast'));
    expect(bcast?.severity).toBe('high');
    expect(bcast?.advice).toMatch(/DISTKEY/);
  });

  it('flags a large sequential scan', () => {
    const nodes = parsePlan(['Seq Scan on big  (cost=0.00..99999.00 rows=5000000 width=8)']);
    const warnings = analyzePlan(nodes);
    expect(warnings.some((w) => w.title.includes('Sequential scan'))).toBe(true);
  });

  it('flags nested loops', () => {
    const nodes = parsePlan(['Nested Loop  (cost=0.00..10.00 rows=5 width=8)']);
    expect(analyzePlan(nodes).some((w) => w.title.includes('Nested Loop'))).toBe(true);
  });

  it('returns no warnings for a clean aggregate plan', () => {
    const nodes = parsePlan(REDSHIFT_EXPLAIN_FIXTURE['tickit.sales aggregate'] ?? []);
    expect(analyzePlan(nodes)).toHaveLength(0);
  });
});

describe('fixtureForSql', () => {
  it('routes join queries to the broadcast plan and others to the aggregate', () => {
    expect(fixtureForSql('SELECT * FROM tickit.sales JOIN tickit.event USING (eventid)')).toBeDefined();
    expect(fixtureForSql('SELECT count(*) FROM tickit.sales')?.[0]).toContain('HashAggregate');
    expect(fixtureForSql('SELECT 1')).toBeUndefined();
  });
});
