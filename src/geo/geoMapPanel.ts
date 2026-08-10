import * as vscode from 'vscode';

/** gis-map-viewer (M7): hosts the inline-SVG geometry map in a webview. No
 * scripts and no external hosts — the SVG is the whole map (offline, CSP-safe). */
export class GeoMapPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  show(svg: string, subtitle: string): void {
    if (this.panel === undefined) {
      this.panel = vscode.window.createWebviewPanel('redlensGeoMap', 'RedLens Map', vscode.ViewColumn.Active, { enableScripts: false });
      this.panel.onDidDispose(() => { this.panel = undefined; });
    }
    const nonce = String(Date.now());
    this.panel.webview.html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">
      <style nonce="${nonce}">
        body { margin: 0; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
        .bar { padding: 6px 10px; border-bottom: 1px solid var(--vscode-widget-border,#444); color: var(--vscode-descriptionForeground); }
        .wrap { overflow: auto; padding: 12px; }
        svg { max-width: none; }
      </style></head>
      <body><div class="bar">${escapeHtml(subtitle)} · no basemap (geometry only, offline)</div><div class="wrap">${svg}</div></body></html>`;
    this.panel.reveal();
  }

  dispose(): void {
    this.panel?.dispose();
  }
}

function escapeHtml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
