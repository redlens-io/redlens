/**
 * Cluster-section webview HTML (pure — no `vscode` import, and no scripts at
 * all: this panel only reads). Every value is escaped and the CSP is
 * `default-src 'none'`, which is what still holds the day someone forgets to
 * escape a parameter description that came back from AWS.
 */
import { escapeHtml } from '../ui/html';
import type { InfoRow, SectionModel } from '../aws/clusterInfo';

export interface ClusterHtmlOptions {
  section: SectionModel;
  /** e.g. "Serverless · redlens-demo · us-east-1". */
  targetLabel: string;
  source: 'live' | 'demo';
}

function row(r: InfoRow): string {
  const badge = r.nonDefault === true ? '<span class="badge">changed</span>' : '';
  const note = r.note === undefined || r.note === '' ? '' : `<div class="note">${escapeHtml(r.note)}</div>`;
  return `<tr class="${r.warn === true ? 'warn' : ''}${r.nonDefault === true ? ' nd' : ''}">
      <th>${escapeHtml(r.label)}</th>
      <td><span class="v">${escapeHtml(r.value)}</span>${badge}${note}</td>
    </tr>`;
}

export function clusterHtml(o: ClusterHtmlOptions): string {
  const groups = o.section.groups
    .map((g) => {
      const body = g.rows.length === 0
        ? '<tr><td class="empty" colspan="2">Nothing in this group.</td></tr>'
        : g.rows.map(row).join('');
      return `<h3>${escapeHtml(g.title)}</h3><div class="twrap"><table>${body}</table></div>`;
    })
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>
    body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); padding: 10px 16px; }
    h2 { margin: 0 0 2px; }
    h3 { margin: 18px 0 6px; font-size: 11px; text-transform: uppercase; color: var(--vscode-descriptionForeground); }
    .sub { color: var(--vscode-descriptionForeground); margin-bottom: 10px; }
    .demo { color: var(--vscode-editorWarning-foreground); }
    .twrap { overflow-x: auto; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border-bottom: 1px solid var(--vscode-widget-border, #444); padding: 5px 8px; text-align: left; vertical-align: top; }
    th { color: var(--vscode-descriptionForeground); font-weight: 600; width: 210px; font-family: var(--vscode-editor-font-family, monospace); }
    td .v { font-variant-numeric: tabular-nums; }
    tr.warn td .v { color: var(--vscode-editorWarning-foreground); font-weight: 600; }
    tr.nd th { color: var(--vscode-foreground); }
    tr.nd td .v { font-weight: 700; }
    .badge { margin-left: 8px; padding: 1px 6px; border-radius: 8px; font-size: 10px; text-transform: uppercase;
             background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .note { color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 3px; max-width: 640px; }
    td.empty { color: var(--vscode-descriptionForeground); font-style: italic; }
    .caveat { margin-top: 16px; color: var(--vscode-descriptionForeground); border-left: 2px solid var(--vscode-widget-border, #444);
              padding-left: 8px; max-width: 640px; }
  </style></head><body>
    <h2>${escapeHtml(o.section.title)}</h2>
    <div class="sub">${escapeHtml(o.targetLabel)}${o.source === 'demo' ? ' · <span class="demo">demo data</span>' : ' · read-only'}</div>
    ${groups}
    ${o.section.note === undefined ? '' : `<div class="caveat">${escapeHtml(o.section.note)}</div>`}
  </body></html>`;
}
