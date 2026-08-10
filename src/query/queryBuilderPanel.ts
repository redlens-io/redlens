import * as vscode from 'vscode';
import { buildSelectSql, type QuerySpec } from './queryBuilder';
import { queryBuilderHtml, type TableRef } from './queryBuilderHtml';

export type { TableRef } from './queryBuilderHtml';

/** visual-query-builder (M7): a form-based SELECT builder. The webview collects
 * the spec; the SQL is always generated on the host by the tested
 * `buildSelectSql`, so the preview and the emitted query never diverge. The
 * page itself comes from queryBuilderHtml() (pure) so the UI harness renders
 * the exact same thing. */
export interface QueryBuilderCallbacks {
  loadColumns(schema: string, table: string): Promise<string[]>;
  onOpen(sql: string): void;
  onRun(sql: string): void;
}

export class QueryBuilderPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly cb: QueryBuilderCallbacks) {}

  async show(tables: TableRef[]): Promise<void> {
    if (tables.length === 0) return;
    if (this.panel === undefined) {
      this.panel = vscode.window.createWebviewPanel('redlensQueryBuilder', 'RedLens Query Builder', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => { this.panel = undefined; });
      this.panel.webview.onDidReceiveMessage((m: unknown) => { void this.handle(m); });
    }
    const first = tables[0]!;
    const columns = await this.cb.loadColumns(first.schema, first.table);
    const initialSpec: QuerySpec = { schema: first.schema, table: first.table, limit: 100 };
    this.panel.webview.html = queryBuilderHtml({ tables, columns, initialSql: buildSelectSql(initialSpec), nonce: String(Date.now()) });
    this.panel.reveal();
  }

  private async handle(m: unknown): Promise<void> {
    const msg = m as { type?: string; spec?: QuerySpec; schema?: string; table?: string };
    if (this.panel === undefined) return;
    if (msg.type === 'spec' && msg.spec !== undefined) {
      this.panel.webview.postMessage({ type: 'sql', sql: buildSelectSql(msg.spec) });
    } else if (msg.type === 'pickTable' && msg.schema !== undefined && msg.table !== undefined) {
      const columns = await this.cb.loadColumns(msg.schema, msg.table);
      this.panel.webview.postMessage({ type: 'columns', columns });
    } else if (msg.type === 'open' && msg.spec !== undefined) {
      // Generate from the spec the webview sent with the click — never the
      // possibly-stale preview text (UXD-019).
      this.cb.onOpen(buildSelectSql(msg.spec));
    } else if (msg.type === 'run' && msg.spec !== undefined) {
      this.cb.onRun(buildSelectSql(msg.spec));
    }
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
