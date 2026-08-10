/**
 * Redshift-style EXPLAIN fixtures for demo mode (A4). Real Redshift plans use
 * "XN" operators and DS_* redistribution markers that Postgres never emits, so
 * these let the visualizer show its warehouse-aware warnings without a cluster.
 */
export const REDSHIFT_EXPLAIN_FIXTURE: Record<string, string[]> = {
  // A join with an expensive broadcast — the classic Redshift anti-pattern.
  'tickit.sales JOIN event': [
    'XN Hash Join DS_BCAST_INNER  (cost=0.09..2650.04 rows=40 width=32)',
    '  Hash Cond: ("outer".eventid = "inner".eventid)',
    '  ->  XN Seq Scan on sales  (cost=0.00..0.40 rows=40 width=16)',
    '  ->  XN Hash  (cost=0.16..0.16 rows=16 width=20)',
    '        ->  XN Seq Scan on event  (cost=0.00..0.16 rows=16 width=20)',
  ],
  // A well-distributed aggregate — no warnings expected.
  'tickit.sales aggregate': [
    'XN HashAggregate  (cost=0.60..0.70 rows=4 width=16)',
    '  ->  XN Seq Scan on sales  (cost=0.00..0.40 rows=40 width=16)',
  ],
};

export function fixtureForSql(sql: string): string[] | undefined {
  const lower = sql.toLowerCase();
  if (lower.includes('join') && lower.includes('sales')) {
    return REDSHIFT_EXPLAIN_FIXTURE['tickit.sales JOIN event'];
  }
  if (lower.includes('sales')) {
    return REDSHIFT_EXPLAIN_FIXTURE['tickit.sales aggregate'];
  }
  return undefined;
}
