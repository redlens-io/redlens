import { parsePlan, type PlanNode } from './planParser';
import { analyzePlan, type PlanWarning } from './planWarnings';
import { queryAll } from '../query/collect';
import { fixtureForSql } from '../demo/explainFixtures';
import type { ActiveConnection } from '../connections/connectionManager';

export interface ExplainResult {
  nodes: PlanNode[];
  warnings: PlanWarning[];
  source: 'live' | 'demo';
}

/** Runs EXPLAIN (or EXPLAIN ANALYZE) on the active connection, or a demo fixture. */
export async function explain(active: ActiveConnection, sql: string, analyze = false): Promise<ExplainResult> {
  const cleaned = sql.trim().replace(/;+\s*$/, '');
  if (active.profile.kind === 'demo') {
    const fixture = fixtureForSql(cleaned);
    if (fixture === undefined) {
      throw new Error('Demo mode has a plan only for the tickit sample queries (try one joining or aggregating tickit.sales).');
    }
    const nodes = parsePlan(fixture);
    return { nodes, warnings: analyzePlan(nodes), source: 'demo' };
  }
  const keyword = analyze ? 'EXPLAIN ANALYZE' : 'EXPLAIN';
  const { rows } = await queryAll(active.transport, `${keyword} ${cleaned}`);
  const lines = rows.map((r) => String(r[0] ?? ''));
  const nodes = parsePlan(lines);
  return { nodes, warnings: analyzePlan(nodes), source: 'live' };
}
