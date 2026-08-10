import * as vscode from 'vscode';
import { EXPORT_EXTENSIONS, type ExportFormat } from '../grid/exporters';
import { gridHtml, getNonce } from './gridHtml';
import { piiColumnIndices } from '../pii/piiMask';
import { readPiiConfig } from '../pii/piiSettings';
import type { GridColumn } from '../grid/gridModel';
import type { EditableSource } from '../edit/editModel';
import type { ChangeSet } from '../edit/dmlBuilder';

export interface GridDataset {
  columns: GridColumn[];
  rows: unknown[][];
  connectionName: string;
  durationMs: number;
  totalRows: number;
  truncated: boolean;
  command: string;
  setLabel?: string;
  /** Present when this result maps 1:1 to a base table with a PK → editable. */
  editable?: EditableSource;
  /** Column indices to mask in the grid (pii-safe-mode). */
  piiColumns?: number[];
}

/** A result column that references another table (fk-navigation). */
export interface FkColumn {
  columnIndex: number;
  refSchema: string;
  refTable: string;
  refColumn: string;
}

/**
 * Interactive results grid (M1) — hosts the webview and handles ops a webview
 * can't do: save-to-file, clipboard, and FK navigation (running a follow-up
 * query). The webview owns sort/filter/search/columns/aggregate/viewers/tabs.
 * The page itself comes from gridHtml() (pure) so the UI harness renders the
 * exact same thing.
 */
export class GridPanel {
  private panel: vscode.WebviewPanel | undefined;
  private pending: { datasets: GridDataset[]; fkColumns: FkColumn[] } | undefined;

  /** Set by the command layer to run a follow-up query on FK navigation. */
  onFkNavigate: ((fk: FkColumn, value: unknown) => void) | undefined;

  /** Set by the command layer to apply grid edits (inline-data-edit). */
  onCommitEdits: ((changeSet: ChangeSet) => void) | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Toggle inline edit mode on the current grid (the webview ignores it when
   * the result is not an editable single-table view). Returns false if no grid
   * is open. */
  toggleEdit(): boolean {
    if (this.panel === undefined) {
      return false;
    }
    void this.panel.webview.postMessage({ type: 'toggleEditMode' });
    return true;
  }

  /** Feed pasted CSV/TSV text to the grid as new rows (paste-csv-grid). The
   * host reads the clipboard because webviews often cannot. */
  pasteRows(text: string): boolean {
    if (this.panel === undefined) {
      return false;
    }
    void this.panel.webview.postMessage({ type: 'pasteRows', text });
    return true;
  }

  /** Toggle the chart view on the current grid (result-charts). */
  toggleChart(): boolean {
    if (this.panel === undefined) {
      return false;
    }
    void this.panel.webview.postMessage({ type: 'toggleChart' });
    return true;
  }

  /** Toggle heatmap colouring on the current grid (grid-heatmap). */
  toggleHeatmap(): boolean {
    if (this.panel === undefined) { return false; }
    void this.panel.webview.postMessage({ type: 'toggleHeatmap' });
    return true;
  }

  /** Toggle the transposed view (transpose-view). */
  toggleTranspose(): boolean {
    if (this.panel === undefined) { return false; }
    void this.panel.webview.postMessage({ type: 'toggleTranspose' });
    return true;
  }

  /** Group the current grid by a column index (grouping-panel). */
  setGroup(column: number): boolean {
    if (this.panel === undefined) { return false; }
    void this.panel.webview.postMessage({ type: 'setGroup', column });
    return true;
  }

  /** Pin the current result as the compare baseline (result-run-compare). */
  pinBaseline(): boolean {
    if (this.panel === undefined) { return false; }
    void this.panel.webview.postMessage({ type: 'pinBaseline' });
    return true;
  }

  /** Toggle the compare-with-baseline view (result-run-compare). */
  toggleCompare(): boolean {
    if (this.panel === undefined) { return false; }
    void this.panel.webview.postMessage({ type: 'toggleCompare' });
    return true;
  }

  /** Re-apply PII masking to the ALREADY-OPEN grid after pii-safe-mode is toggled
   * (UXD-031): recompute which columns are PII under the current config and push
   * them so the open result re-masks live — instead of leaving raw PII on screen
   * until the user re-runs the query. Preserves the user's sort/filter/scroll. */
  refreshPiiMasking(): boolean {
    if (this.panel === undefined || this.pending === undefined) { return false; }
    const config = readPiiConfig();
    const piiPerSet = this.pending.datasets.map((d) => piiColumnIndices(d.columns, config));
    this.pending = {
      ...this.pending,
      datasets: this.pending.datasets.map((d, i) => ({ ...d, piiColumns: piiPerSet[i] })),
    };
    void this.panel.webview.postMessage({ type: 'updatePii', piiPerSet });
    return true;
  }

  show(datasets: GridDataset[], fkColumns: FkColumn[] = []): void {
    if (this.panel === undefined) {
      this.panel = vscode.window.createWebviewPanel('redlensGrid', 'RedLens Results', {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
      }, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => { this.panel = undefined; });
      this.panel.webview.onDidReceiveMessage((msg) => this.onMessage(msg));
      this.panel.webview.html = this.html(this.panel.webview);
    }
    this.pending = { datasets, fkColumns };
    void this.panel.webview.postMessage({ type: 'setData', datasets, fkColumns });
    this.panel.reveal(vscode.ViewColumn.Beside, true);
  }

  private onMessage(msg: { type: string; format?: string; content?: string; columnIndex?: number; value?: unknown; changeSet?: ChangeSet; text?: string }): void {
    if (msg.type === 'ready' && this.pending !== undefined) {
      void this.panel?.webview.postMessage({ type: 'setData', ...this.pending });
    } else if (msg.type === 'info' && msg.text !== undefined) {
      void vscode.window.showInformationMessage(msg.text);
    } else if (msg.type === 'clipboard' && msg.content !== undefined) {
      void vscode.env.clipboard.writeText(msg.content).then(() => vscode.window.setStatusBarMessage('RedLens: copied to clipboard', 2000));
    } else if (msg.type === 'saveFile' && msg.content !== undefined && msg.format !== undefined) {
      void this.save(msg.format as ExportFormat, msg.content);
    } else if (msg.type === 'fkNavigate' && msg.columnIndex !== undefined) {
      const fk = this.pending?.fkColumns.find((f) => f.columnIndex === msg.columnIndex);
      if (fk !== undefined && this.onFkNavigate !== undefined) {
        this.onFkNavigate(fk, msg.value);
      }
    } else if (msg.type === 'commitEdits' && msg.changeSet !== undefined && this.onCommitEdits !== undefined) {
      this.onCommitEdits(msg.changeSet);
    }
  }

  private async save(format: ExportFormat, content: string): Promise<void> {
    // Suggest a filename so the user isn't retyping one on every export (UXD-047).
    const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultName = `redlens-results.${EXPORT_EXTENSIONS[format]}`;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: wsFolder !== undefined ? vscode.Uri.joinPath(wsFolder, defaultName) : undefined,
      filters: { [format.toUpperCase()]: [EXPORT_EXTENSIONS[format]] },
      saveLabel: 'Export results',
    });
    if (uri === undefined) {
      return;
    }
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    void vscode.window.showInformationMessage(`RedLens: exported to ${uri.fsPath}`);
  }

  private html(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'grid.js'));
    return gridHtml({ scriptSrc: scriptUri.toString(), nonce: getNonce() });
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
