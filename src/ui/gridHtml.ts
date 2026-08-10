/**
 * Grid webview HTML (pure — no `vscode` import) so both GridPanel and the
 * UI-interaction harness (ui-tests/) render the EXACT same page. `prelude` is
 * harness-only: an inline script injected before the bundle (used to stub
 * `acquireVsCodeApi`); production callers omit it.
 */
export interface GridHtmlOptions {
  /** URI/path of the bundled webview script (dist/webview/grid.js). Production. */
  scriptSrc?: string;
  /** Bundle source inlined instead of loaded via src (UI harness only). */
  inlineScript?: string;
  nonce: string;
  /** Harness-only inline script that runs before the bundle. */
  prelude?: string;
}

export function gridHtml(o: GridHtmlOptions): string {
  const prelude = o.prelude !== undefined ? `<script nonce="${o.nonce}">${o.prelude}</script>` : '';
  const main = o.inlineScript !== undefined
    ? `<script nonce="${o.nonce}">${o.inlineScript}</script>`
    : `<script nonce="${o.nonce}" src="${o.scriptSrc}"></script>`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${o.nonce}';">
      <style>
        body { margin: 0; font-family: var(--vscode-font-family); font-size: 12px; color: var(--vscode-foreground); }
        .tabs { display: flex; gap: 2px; padding: 4px 8px 0; }
        .tab { padding: 3px 10px; cursor: pointer; border: 1px solid var(--vscode-widget-border, #444); border-bottom: none; background: var(--vscode-editorWidget-background); }
        .tab.active { background: var(--vscode-tab-activeBackground, var(--vscode-editor-background)); font-weight: 600; }
        .toolbar { position: sticky; top: 0; background: var(--vscode-editor-background); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 8px; border-bottom: 1px solid var(--vscode-widget-border, #444); z-index: 5; }
        .toolbar input#search { flex: 0 0 220px; }
        input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, #555); padding: 2px 4px; }
        button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 3px 8px; cursor: pointer; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .meta { margin-left: auto; color: var(--vscode-descriptionForeground); }
        .gridwrap { overflow: auto; max-height: calc(100vh - 120px); }
        table { border-collapse: collapse; width: max-content; }
        th, td { border: 1px solid var(--vscode-widget-border, #444); padding: 2px 8px; text-align: left; white-space: nowrap; max-width: 420px; overflow: hidden; text-overflow: ellipsis; }
        thead th { position: sticky; top: 0; background: var(--vscode-editorWidget-background); }
        .hname { cursor: pointer; } .hide { margin-left: 6px; opacity: 0.4; cursor: pointer; } .hide:hover { opacity: 1; }
        .fkcol { color: var(--vscode-textLink-foreground); font-size: 10px; font-weight: 700; }
        td.fk { color: var(--vscode-textLink-foreground); cursor: alias; text-decoration: underline dotted; }
        tr.filters input { width: 90%; font-size: 11px; }
        tbody tr:nth-child(even) td { background: var(--vscode-list-hoverBackground); }
        td.null { color: var(--vscode-descriptionForeground); font-style: italic; }
        td.sel { background: var(--vscode-editor-selectionBackground) !important; }
        .aggbar { padding: 4px 8px; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-widget-border, #444); font-variant-numeric: tabular-nums; }
        .menu { position: fixed; background: var(--vscode-menu-background, #252526); border: 1px solid var(--vscode-menu-border, #555); z-index: 10; }
        .menu.hidden, .viewer.hidden { display: none; }
        .mi { padding: 4px 16px; cursor: pointer; } .mi:hover { background: var(--vscode-menu-selectionBackground, #094771); }
        .viewer { position: fixed; right: 0; bottom: 0; width: 45%; max-height: 50%; overflow: auto; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, #444); }
        .vhead { padding: 4px 8px; border-bottom: 1px solid var(--vscode-widget-border, #444); } #vclose { float: right; cursor: pointer; }
        .viewer pre { margin: 0; padding: 8px; white-space: pre-wrap; word-break: break-all; }
        .hint { padding: 2px 8px; color: var(--vscode-descriptionForeground); font-size: 11px; }
        button.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
        button.commit { background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-weight: 600; }
        td.edited { background: var(--vscode-diffEditor-insertedTextBackground, rgba(80,160,80,0.25)) !important; outline: 1px solid var(--vscode-charts-green, #4caf50); }
        td.editable { cursor: cell; }
        tr.deleted td { text-decoration: line-through; opacity: 0.5; background: var(--vscode-diffEditor-removedTextBackground, rgba(200,80,80,0.18)) !important; }
        tr.insert td { background: var(--vscode-diffEditor-insertedLineBackground, rgba(80,160,80,0.10)); }
        td.rowact { text-align: center; cursor: pointer; color: var(--vscode-descriptionForeground); width: 1%; }
        td.rowact:hover { color: var(--vscode-errorForeground); }
        td.editing { padding: 0; } td.editing input { width: 100%; box-sizing: border-box; border: 1px solid var(--vscode-focusBorder); }
        td.masked { color: var(--vscode-descriptionForeground); letter-spacing: 1px; user-select: none; cursor: not-allowed; }
        .chartbar { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; padding: 8px; border-bottom: 1px solid var(--vscode-widget-border, #444); }
        .chartbar select, .grouplbl select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border, #555); padding: 2px 4px; }
        .grouplbl { display: inline-flex; gap: 4px; align-items: center; color: var(--vscode-descriptionForeground); }
        tbody tr.vspacer td { padding: 0; border: 0; }
        tr.cmp-added td { background: rgba(80,160,80,0.18) !important; }
        tr.cmp-removed td { background: rgba(200,80,80,0.16) !important; text-decoration: line-through; opacity: 0.85; }
        tr.cmp-changed td { background: rgba(210,170,60,0.14) !important; }
        td.cmpk, th.cmpk { text-align: center; font-weight: 700; width: 1%; }
        .was { color: var(--vscode-descriptionForeground); font-size: 10px; }
        .cmp-added-t { color: var(--vscode-charts-green); } .cmp-removed-t { color: var(--vscode-charts-red); } .cmp-changed-t { color: var(--vscode-charts-yellow); }
        .chartbar .vals { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .chartbar .vk { display: inline-flex; gap: 4px; align-items: center; }
        .chartwrap { padding: 8px 8px 0; max-height: calc(100vh - 200px); overflow: auto; }
        .legend { display: flex; flex-wrap: wrap; gap: 12px; padding: 6px 8px 12px; color: var(--vscode-descriptionForeground); }
        .legend .lg { display: inline-flex; gap: 5px; align-items: center; }
        .legend .sw { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
      </style></head>
      <body><div id="app"></div>${prelude}${main}</body></html>`;
}

export function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
