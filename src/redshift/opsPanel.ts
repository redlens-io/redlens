import * as vscode from 'vscode';
import { escapeHtml } from '../ui/html';
import { analyzeSessions, summarizeDatashares, summarizeSpectrum, formatBytes, type DatashareRow, type ExternalTableRow, type LockRow, type SessionRow } from './opsViews';

function shell(title: string, sub: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>
    body { font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); padding: 10px 16px; overflow-x: auto; }
    h2 { margin: 0 0 2px; } h3 { margin: 18px 0 6px; }
    .sub { color: var(--vscode-descriptionForeground); margin-bottom: 12px; } .demo { color: var(--vscode-editorWarning-foreground); }
    .stats { display: flex; gap: 24px; margin-bottom: 8px; flex-wrap: wrap; }
    .stat .v { font-size: 20px; font-weight: 700; } .stat .l { color: var(--vscode-descriptionForeground); font-size: 11px; }
    table { border-collapse: collapse; width: 100%; margin-top: 4px; }
    th, td { border-bottom: 1px solid var(--vscode-widget-border, #444); padding: 4px 8px; text-align: left; vertical-align: top; }
    th { color: var(--vscode-descriptionForeground); }
    td.num { text-align: right; font-variant-numeric: tabular-nums; } .warn { color: var(--vscode-editorWarning-foreground); } .err { color: var(--vscode-editorError-foreground); }
    td.sql, td.mono { font-family: var(--vscode-editor-font-family, monospace); }
    td.sql { max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .note { color: var(--vscode-descriptionForeground); font-size: 11px; }
  </style></head><body><h2>${title}</h2><div class="sub">${sub}</div>${body}</body></html>`;
}

function srcTag(name: string, source: 'live' | 'demo', realNote: string): string {
  return `${escapeHtml(name)}${source === 'demo' ? ' · <span class="demo">demo data (SYS_* fixtures)</span>' : ' · ' + realNote}`;
}

export class SessionsPanel {
  private panel: vscode.WebviewPanel | undefined;
  show(sessions: SessionRow[], locks: LockRow[], name: string, source: 'live' | 'demo'): void {
    this.panel ??= this.create();
    this.panel.webview.html = renderSessionsHtml(sessions, locks, name, source);
    this.panel.reveal();
  }
  private create(): vscode.WebviewPanel {
    const p = vscode.window.createWebviewPanel('redlensSessions', 'RedLens Sessions & Locks', { viewColumn: vscode.ViewColumn.Active });
    p.onDidDispose(() => { this.panel = undefined; });
    return p;
  }
  dispose(): void { this.panel?.dispose(); }
}

export function renderSessionsHtml(sessions: SessionRow[], locks: LockRow[], name: string, source: 'live' | 'demo'): string {
  const a = analyzeSessions(sessions, locks);
  const rows = sessions.map((s) => {
    const blocked = a.blocking.find((b) => b.blockedPid === s.pid);
    return `<tr>
      <td>${s.pid}</td><td>${escapeHtml(s.user)}</td>
      <td class="${s.state === 'idle in transaction' ? 'warn' : ''}">${escapeHtml(s.state)}</td>
      <td class="num">${s.durationSec.toLocaleString()}s</td>
      <td class="${blocked ? 'err' : ''}">${blocked ? `blocked by ${blocked.blockerPid} on ${escapeHtml(blocked.table)}` : ''}</td>
      <td class="sql">${escapeHtml(s.queryText)}</td>
    </tr>`;
  }).join('');
  const body = `<div class="stats">
      <div class="stat"><div class="v">${a.active}</div><div class="l">active</div></div>
      <div class="stat"><div class="v ${a.idleInTx > 0 ? 'warn' : ''}">${a.idleInTx}</div><div class="l">idle in transaction</div></div>
      <div class="stat"><div class="v ${a.blocking.length ? 'err' : ''}">${a.blocking.length}</div><div class="l">blocked</div></div>
      <div class="stat"><div class="v">${a.longestSec.toLocaleString()}s</div><div class="l">longest</div></div>
    </div>
    ${a.blocking.length ? `<div class="note err">⚠ ${a.blocking.map((b) => `pid ${b.blockedPid} waits on pid ${b.blockerPid} (${escapeHtml(b.table)})`).join('; ')}</div>` : ''}
    <table><thead><tr><th>pid</th><th>user</th><th>state</th><th>duration</th><th>blocked</th><th>query</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="note">No active sessions.</td></tr>'}</tbody></table>`;
  return shell('Sessions & Locks', srcTag(name, source, 'from STV_SESSIONS / STV_LOCKS'), body);
}

export class SharingPanel {
  private panel: vscode.WebviewPanel | undefined;
  show(shares: DatashareRow[], external: ExternalTableRow[], name: string, source: 'live' | 'demo'): void {
    this.panel ??= this.create();
    this.panel.webview.html = renderSharingHtml(shares, external, name, source);
    this.panel.reveal();
  }
  private create(): vscode.WebviewPanel {
    const p = vscode.window.createWebviewPanel('redlensSharing', 'RedLens Datashares & Spectrum', { viewColumn: vscode.ViewColumn.Active });
    p.onDidDispose(() => { this.panel = undefined; });
    return p;
  }
  dispose(): void { this.panel?.dispose(); }
}

export function renderSharingHtml(shares: DatashareRow[], external: ExternalTableRow[], name: string, source: 'live' | 'demo'): string {
  const ds = summarizeDatashares(shares);
  const sp = summarizeSpectrum(external);
  const shareRows = shares.map((s) => `<tr>
    <td>${escapeHtml(s.shareName)}</td><td>${s.shareType}</td>
    <td>${escapeHtml(s.producerAccount)}/${escapeHtml(s.producerNamespace)}</td>
    <td class="num">${s.objectCount}</td></tr>`).join('');
  const extRows = external.map((t) => `<tr>
    <td>${escapeHtml(t.schema)}.${escapeHtml(t.table)}</td>
    <td class="mono">${escapeHtml(t.location)}</td><td>${escapeHtml(t.format)}</td>
    <td class="${t.partitionKeys.length === 0 ? 'warn' : ''}">${t.partitionKeys.length === 0 ? 'none' : escapeHtml(t.partitionKeys.join(', ')) + ` (${t.partitionCount})`}</td>
    <td class="num">${formatBytes(t.scannedBytes)}</td></tr>`).join('');
  const body = `
    <h3>Datashares</h3>
    <div class="stats">
      <div class="stat"><div class="v">${ds.outbound.length}</div><div class="l">outbound</div></div>
      <div class="stat"><div class="v">${ds.inbound.length}</div><div class="l">inbound</div></div>
      <div class="stat"><div class="v">${ds.totalObjects}</div><div class="l">shared objects</div></div>
    </div>
    <table><thead><tr><th>share</th><th>type</th><th>producer</th><th>objects</th></tr></thead><tbody>${shareRows || '<tr><td colspan="4" class="note">no datashares</td></tr>'}</tbody></table>
    <h3>Spectrum external tables</h3>
    <div class="stats">
      <div class="stat"><div class="v">${sp.tables}</div><div class="l">external tables</div></div>
      <div class="stat"><div class="v">${sp.totalPartitions.toLocaleString()}</div><div class="l">partitions</div></div>
      <div class="stat"><div class="v">${formatBytes(sp.totalScannedBytes)}</div><div class="l">scanned (recent)</div></div>
      <div class="stat"><div class="v ${sp.unpartitioned.length ? 'warn' : ''}">${sp.unpartitioned.length}</div><div class="l">unpartitioned (full-scan risk)</div></div>
    </div>
    <table><thead><tr><th>table</th><th>location</th><th>format</th><th>partitions</th><th>scanned</th></tr></thead><tbody>${extRows || '<tr><td colspan="5" class="note">no external tables</td></tr>'}</tbody></table>`;
  return shell('Datashares & Spectrum', srcTag(name, source, 'from SVV_DATASHARES / SVV_EXTERNAL_*'), body);
}
