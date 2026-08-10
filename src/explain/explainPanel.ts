import * as vscode from 'vscode';
import { escapeHtml } from '../ui/html';
import type { PlanNode } from './planParser';
import type { PlanWarning } from './planWarnings';

const SEVERITY_META: Record<PlanWarning['severity'], { icon: string; color: string; label: string }> = {
  high: { icon: '⛔', color: 'var(--vscode-editorError-foreground)', label: 'HIGH' },
  medium: { icon: '⚠️', color: 'var(--vscode-editorWarning-foreground)', label: 'MEDIUM' },
  info: { icon: 'ℹ️', color: 'var(--vscode-editorInfo-foreground)', label: 'INFO' },
};

export class ExplainPanel {
  private panel: vscode.WebviewPanel | undefined;

  show(nodes: PlanNode[], warnings: PlanWarning[], title: string): void {
    if (this.panel === undefined) {
      this.panel = vscode.window.createWebviewPanel('redlensExplain', 'RedLens EXPLAIN', {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }
    this.panel.webview.html = renderExplainHtml(nodes, warnings, title);
    this.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  dispose(): void {
    this.panel?.dispose();
  }
}

export function renderExplainHtml(nodes: PlanNode[], warnings: PlanWarning[], title: string): string {
  const warnByNode = new Map<number, PlanWarning[]>();
  for (const w of warnings) {
    const list = warnByNode.get(w.nodeIndex) ?? [];
    list.push(w);
    warnByNode.set(w.nodeIndex, list);
  }

  const tree = nodes
    .map((node, i) => {
      const nodeWarnings = warnByNode.get(i) ?? [];
      const badges = nodeWarnings
        .map((w) => `<span class="badge" style="color:${SEVERITY_META[w.severity].color}" title="${escapeHtml(w.advice)}">${SEVERITY_META[w.severity].icon} ${escapeHtml(w.title)}</span>`)
        .join('');
      const costTag = node.cost !== undefined ? `<span class="cost">rows≈${node.cost.rows.toLocaleString()} · cost ${node.cost.total.toLocaleString()}</span>` : '';
      const maxActual = Math.max(1, ...nodes.map((n) => n.actualMs ?? 0));
      const timeTag = node.actualMs !== undefined
        ? `<span class="time">${node.actualMs.toFixed(2)} ms</span><span class="bar" style="width:${Math.round((node.actualMs / maxActual) * 120)}px"></span>`
        : '';
      const details = node.details.length > 0 ? `<div class="details">${node.details.map((d) => escapeHtml(d)).join('<br>')}</div>` : '';
      return `<div class="node" style="margin-left:${node.depth * 20}px">
        <div class="op">${escapeHtml(node.text)} ${costTag} ${timeTag} ${badges}</div>
        ${details}
      </div>`;
    })
    .join('');

  const summary =
    warnings.length === 0
      ? '<div class="ok">✓ No redistribution or scan warnings detected.</div>'
      : `<div class="warnsummary">${warnings.length} warning(s): ${warnings.filter((w) => w.severity === 'high').length} high, ${warnings.filter((w) => w.severity === 'medium').length} medium.</div>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>
    body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); padding: 8px 12px; overflow-x: auto; }
    h3 { margin: 0 0 4px; }
    .sub { color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
    .node { padding: 3px 0; border-left: 2px solid var(--vscode-widget-border, #444); padding-left: 8px; }
    .op { font-family: var(--vscode-editor-font-family, monospace); }
    .cost { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .time { color: var(--vscode-charts-orange, #d18616); font-size: 11px; margin-left: 8px; }
    .bar { display: inline-block; height: 8px; background: var(--vscode-charts-orange, #d18616); margin-left: 6px; vertical-align: middle; border-radius: 2px; }
    .badge { margin-left: 8px; font-size: 11px; cursor: help; }
    .details { color: var(--vscode-descriptionForeground); font-size: 11px; margin: 2px 0 0 12px; font-family: var(--vscode-editor-font-family, monospace); }
    .ok { color: var(--vscode-testing-iconPassed, #3fb950); margin-bottom: 10px; }
    .warnsummary { color: var(--vscode-editorWarning-foreground); margin-bottom: 10px; font-weight: 600; }
    .advice { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--vscode-widget-border, #444); }
    .advice li { margin-bottom: 6px; }
  </style></head><body>
    <h3>Execution Plan</h3>
    <div class="sub">${escapeHtml(title)}</div>
    ${summary}
    ${tree}
    ${warnings.length > 0 ? `<div class="advice"><strong>How to fix:</strong><ul>${warnings.map((w) => `<li>${SEVERITY_META[w.severity].icon} <strong>${escapeHtml(w.title)}:</strong> ${escapeHtml(w.advice)}</li>`).join('')}</ul></div>` : ''}
  </body></html>`;
}
