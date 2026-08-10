import type { PlanNode } from './planParser';

/** Re-serializes parsed plan nodes to indented text for the AI prompt. */
export function planToText(nodes: readonly PlanNode[]): string {
  return nodes
    .map((n) => {
      const indent = '  '.repeat(n.depth);
      const cost = n.cost !== undefined ? `  (rows=${n.cost.rows} cost=${n.cost.total})` : '';
      const details = n.details.map((d) => `${indent}    ${d}`).join('\n');
      return `${indent}${n.text}${cost}${details.length > 0 ? '\n' + details : ''}`;
    })
    .join('\n');
}
