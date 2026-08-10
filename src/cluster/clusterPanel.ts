import * as vscode from 'vscode';
import { clusterHtml } from './clusterHtml';
import type { SectionModel } from '../aws/clusterInfo';

/** One reusable panel for every Cluster section — opening a second section
 * replaces the content instead of piling up editors. */
export class ClusterPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  show(section: SectionModel, targetLabel: string, source: 'live' | 'demo'): void {
    if (this.panel === undefined) {
      this.panel = vscode.window.createWebviewPanel('redlensCluster', 'RedLens Cluster', {
        viewColumn: vscode.ViewColumn.Active,
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }
    this.panel.title = `RedLens · ${section.title}`;
    this.panel.webview.html = clusterHtml({ section, targetLabel, source });
    this.panel.reveal();
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
