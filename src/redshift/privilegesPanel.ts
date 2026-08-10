import * as vscode from 'vscode';
import { escapeHtml } from '../ui/html';
import { objectLabel, type ObjectPrivileges, type ObjectRef, type PrivilegeGrant } from './privileges';

/**
 * Read-only privileges viewer (M8b2): who can do what on a table/schema —
 * including grants to RBAC roles (not shown per-object by any incumbent) and
 * column-level grants. Same read-only webview pattern as opsPanel; the HTML is a
 * pure function (tested), so no interactive webview / uitest is needed.
 */

const TYPE_BADGE: Record<PrivilegeGrant['granteeType'], string> = {
  role: 'role',
  user: 'user',
  group: 'group',
  public: 'PUBLIC',
};

export function renderPrivilegesHtml(
  ref: ObjectRef,
  priv: ObjectPrivileges,
  name: string,
  source: 'live' | 'demo',
): string {
  const roleGrants = priv.grants.filter((g) => g.granteeType === 'role').length;
  const colGrants = priv.grants.filter((g) => g.column).length;
  const rows = priv.grants
    .map(
      (g) => `<tr>
      <td>${escapeHtml(g.grantee)}</td>
      <td><span class="badge ${g.granteeType}">${TYPE_BADGE[g.granteeType]}</span></td>
      <td class="mono">${escapeHtml(g.privilege)}</td>
      <td class="mono">${g.column ? escapeHtml(g.column) : '<span class="dim">— all —</span>'}</td>
      <td>${g.withGrantOption ? '✓' : ''}</td>
    </tr>`,
    )
    .join('');
  const srcNote =
    source === 'demo'
      ? ' · <span class="demo">demo data</span>'
      : priv.source === 'show-grants'
        ? ' · from SHOW GRANTS'
        : ' · from SVV_RELATION_PRIVILEGES (SHOW GRANTS unavailable)';
  const caveats: string[] = [];
  if (priv.columnGrantsBestEffort) {
    caveats.push('Column-level grants could not be read (SVV_COLUMN_PRIVILEGES absent or not permitted) — this view may be incomplete.');
  }
  caveats.push('Object owners and superusers hold implicit rights not shown as grant rows.');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>
    body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); padding: 10px 16px; overflow-x: auto; }
    h2 { margin: 0 0 2px; } .sub { color: var(--vscode-descriptionForeground); margin-bottom: 12px; } .demo { color: var(--vscode-editorWarning-foreground); }
    .stats { display: flex; gap: 24px; margin-bottom: 10px; flex-wrap: wrap; }
    .stat .v { font-size: 20px; font-weight: 700; } .stat .l { color: var(--vscode-descriptionForeground); font-size: 11px; }
    table { border-collapse: collapse; width: 100%; margin-top: 4px; }
    th, td { border-bottom: 1px solid var(--vscode-widget-border, #444); padding: 4px 8px; text-align: left; }
    th { color: var(--vscode-descriptionForeground); }
    td.mono { font-family: var(--vscode-editor-font-family, monospace); } .dim { color: var(--vscode-descriptionForeground); }
    .badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; border: 1px solid var(--vscode-widget-border, #555); }
    .badge.role { color: var(--vscode-charts-purple, #b180d7); border-color: currentColor; }
    .badge.public { color: var(--vscode-editorWarning-foreground); border-color: currentColor; }
    .note { color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 10px; }
    .note li { margin: 2px 0; }
  </style></head><body>
    <h2>Privileges — ${escapeHtml(objectLabel(ref))}</h2>
    <div class="sub">${escapeHtml(name)}${srcNote}</div>
    <div class="stats">
      <div class="stat"><div class="v">${priv.grants.length}</div><div class="l">grants</div></div>
      <div class="stat"><div class="v">${roleGrants}</div><div class="l">to RBAC roles</div></div>
      <div class="stat"><div class="v">${colGrants}</div><div class="l">column-level</div></div>
    </div>
    <table><thead><tr><th>grantee</th><th>type</th><th>privilege</th><th>column</th><th>grantable</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="dim">No explicit grants (owner/superuser access is implicit).</td></tr>'}</tbody></table>
    <ul class="note">${caveats.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
    <div class="note">Use “RedLens: Script GRANT/REVOKE for Object” to generate reviewable SQL.</div>
  </body></html>`;
}

export class PrivilegesPanel {
  private panel: vscode.WebviewPanel | undefined;
  show(ref: ObjectRef, priv: ObjectPrivileges, name: string, source: 'live' | 'demo'): void {
    this.panel ??= this.create();
    this.panel.webview.html = renderPrivilegesHtml(ref, priv, name, source);
    this.panel.reveal();
  }
  private create(): vscode.WebviewPanel {
    const p = vscode.window.createWebviewPanel('redlensPrivileges', 'RedLens Object Privileges', {
      viewColumn: vscode.ViewColumn.Active,
    });
    p.onDidDispose(() => {
      this.panel = undefined;
    });
    return p;
  }
  dispose(): void {
    this.panel?.dispose();
  }
}
