/**
 * Parses EXPLAIN text output into a flat, depth-annotated node list.
 * Handles both dialects (PLAN §5 / A4):
 *  - Postgres (pg-compat): "  ->  Hash Join  (cost=..)" with indented "->" nodes
 *  - Redshift: "XN Hash Join DS_BCAST_INNER  (cost=..)" — same shape, richer
 *    operator names and DS_* redistribution markers
 * The transport returns EXPLAIN as one text column ("QUERY PLAN"); each row is
 * one line. Pure and unit-tested — no vscode dependency.
 *
 * Structural rule (robust across versions/dialects): a NODE is the first
 * non-empty line, or any line that begins with "->". Every other line is an
 * attribute (Hash Cond:, Filter:, Sort Key:, …) of the most recent node.
 * Depth comes from an indent stack, so "Hash Cond" is never mistaken for the
 * "Hash Join" operator just because both contain "Hash".
 */
export interface PlanNode {
  depth: number;
  /** Operator line without the leading "-> " marker (e.g. "Hash Join"). */
  text: string;
  /** Attribute lines attached below (Filter:, Hash Cond:, ...). */
  details: string[];
  cost?: { startup: number; total: number; rows: number };
  /** Total actual time (ms) for the node when EXPLAIN ANALYZE was used. */
  actualMs?: number;
}

const COST_RE = /\(cost=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)/;
const ACTUAL_RE = /\(actual time=([\d.]+)\.\.([\d.]+)\s+rows=(\d+)\s+loops=(\d+)\)/;

export function parsePlan(lines: readonly string[]): PlanNode[] {
  const nodes: PlanNode[] = [];
  const indentStack: number[] = [];

  for (const raw of lines) {
    if (raw.trim().length === 0) {
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    const trimmed = raw.trim();
    const isNode = nodes.length === 0 || trimmed.startsWith('->');

    if (isNode) {
      const text = trimmed.replace(/^->\s*/, '');
      while (indentStack.length > 0 && (indentStack[indentStack.length - 1] ?? 0) >= indent) {
        indentStack.pop();
      }
      const depth = indentStack.length;
      indentStack.push(indent);

      const node: PlanNode = { depth, text: stripCost(text), details: [] };
      const cost = COST_RE.exec(text);
      if (cost !== null) {
        node.cost = {
          startup: Number.parseFloat(cost[1] ?? '0'),
          total: Number.parseFloat(cost[2] ?? '0'),
          rows: Number.parseInt(cost[3] ?? '0', 10),
        };
      }
      const actual = ACTUAL_RE.exec(text);
      if (actual !== null) {
        node.actualMs = Number.parseFloat(actual[2] ?? '0') * Number.parseInt(actual[4] ?? '1', 10);
      }
      nodes.push(node);
    } else {
      nodes[nodes.length - 1]?.details.push(trimmed);
    }
  }
  return nodes;
}

function stripCost(text: string): string {
  return text.replace(/\s*\(cost=.*$/, '').replace(/\s*\(actual time=.*$/, '').trim();
}
