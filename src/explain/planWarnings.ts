import type { PlanNode } from './planParser';

export type WarningSeverity = 'high' | 'medium' | 'info';

export interface PlanWarning {
  nodeIndex: number;
  severity: WarningSeverity;
  title: string;
  advice: string;
}

/**
 * Warehouse-aware heuristics on a parsed plan (the differentiator vs a plain
 * client). Redshift-specific markers (DS_BCAST/DS_DIST) are the highest-value
 * signals; generic ones (nested loop, big seq scan) help on compat too.
 */
export function analyzePlan(nodes: readonly PlanNode[]): PlanWarning[] {
  const warnings: PlanWarning[] = [];
  nodes.forEach((node, i) => {
    const text = node.text;

    if (/DS_BCAST_INNER/i.test(text)) {
      warnings.push({
        nodeIndex: i,
        severity: 'high',
        title: 'Broadcast of inner table (DS_BCAST_INNER)',
        advice: 'The inner table is broadcast to every node. Co-locate the join with matching DISTKEY on the join column, or the query will not scale.',
      });
    }
    if (/DS_DIST_(BOTH|INNER|OUTER)/i.test(text)) {
      warnings.push({
        nodeIndex: i,
        severity: 'high',
        title: 'Redistribution during join (DS_DIST_*)',
        advice: 'Rows are redistributed across nodes for this join. Set a DISTKEY on the join column of both tables to avoid the network shuffle.',
      });
    }
    if (/Nested Loop/i.test(text)) {
      warnings.push({
        nodeIndex: i,
        severity: 'medium',
        title: 'Nested Loop join',
        advice: 'Nested loops are quadratic on large inputs. Check that join columns are indexed/sorted and statistics are fresh (ANALYZE).',
      });
    }
    if (/Seq Scan|XN Seq Scan/i.test(text) && (node.cost?.rows ?? 0) > 100_000) {
      warnings.push({
        nodeIndex: i,
        severity: 'medium',
        title: `Sequential scan over ~${(node.cost?.rows ?? 0).toLocaleString()} rows`,
        advice: 'Full-table scan on a large table. Add a WHERE filter on the SORTKEY, or define a SORTKEY that matches your predicates.',
      });
    }
    if (node.details.some((d) => /Rows Removed by Filter:\s*([1-9]\d{4,})/.test(d))) {
      warnings.push({
        nodeIndex: i,
        severity: 'info',
        title: 'Filter discards many rows',
        advice: 'The scan reads far more rows than it keeps. A SORTKEY or better predicate placement would let the engine skip blocks.',
      });
    }
  });
  return warnings;
}
