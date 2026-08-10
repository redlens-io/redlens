import * as vscode from 'vscode';
import { gatedCommand } from '../licensing/gate';
import { explain } from '../explain/explainService';
import { ExplainPanel } from '../explain/explainPanel';
import { SessionsPanel, SharingPanel } from '../redshift/opsPanel';
import { DEMO_DATASHARES, DEMO_EXTERNAL_TABLES, DEMO_LOCKS, DEMO_SESSIONS } from '../redshift/opsFixtures';
import type { ConnectionManager } from '../connections/connectionManager';

/**
 * The Free half of what used to be "advanced commands": the EXPLAIN visualizer
 * and the two read-only operational panels.
 *
 * The Fase O split took the other nine out of this file — the dashboard, the
 * advisor, monitoring and the five AI commands now live in the Pro extension.
 * What is left is deliberately the shape of the Free tier's promise: you can
 * see the plan for a query and what the warehouse is doing right now, without
 * paying. What costs money is the advice about it.
 */
export function registerAdvancedCommands(
  context: vscode.ExtensionContext,
  manager: ConnectionManager,
): void {
  const explainPanel = new ExplainPanel();
  const sessionsPanel = new SessionsPanel();
  const sharingPanel = new SharingPanel();
  context.subscriptions.push(explainPanel, sessionsPanel, sharingPanel);

  context.subscriptions.push(
    gatedCommand('redlens.explainQuery', async () => {
      const active = manager.getActive();
      const sql = currentSql();
      if (active === undefined || sql === undefined) {
        return;
      }
      try {
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: 'RedLens: computing plan…' },
          () => explain(active, sql),
        );
        explainPanel.show(result.nodes, result.warnings, `${active.profile.name}${result.source === 'demo' ? ' · demo plan' : ''}`);
      } catch (err) {
        void vscode.window.showErrorMessage(`RedLens: EXPLAIN failed — ${message(err)}`);
      }
    }),

    gatedCommand('redlens.explainAnalyze', async () => {
      const active = manager.getActive();
      const sql = currentSql();
      if (active === undefined || sql === undefined) {
        return;
      }
      if (active.profile.kind === 'demo') {
        void vscode.window.showInformationMessage('RedLens: EXPLAIN ANALYZE runs the query — connect to a real database (it is disabled in demo mode).');
        return;
      }
      try {
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Window, title: 'RedLens: running EXPLAIN ANALYZE…' },
          () => explain(active, sql, true),
        );
        explainPanel.show(result.nodes, result.warnings, `${active.profile.name} · analyze (actual times)`);
      } catch (err) {
        void vscode.window.showErrorMessage(`RedLens: EXPLAIN ANALYZE failed — ${message(err)}`);
      }
    }),

    gatedCommand('redlens.sessionsLocks', async () => {
      const active = manager.getActive();
      if (active === undefined) {
        void vscode.window.showInformationMessage('RedLens: connect first — sessions/locks read STV_SESSIONS / STV_LOCKS.');
        return;
      }
      if (active.profile.kind === 'demo') {
        sessionsPanel.show(DEMO_SESSIONS, DEMO_LOCKS, active.profile.name, 'demo');
        return;
      }
      const choice = await vscode.window.showInformationMessage('RedLens: sessions & locks need Amazon Redshift. Preview with demo data?', 'Show demo');
      if (choice === 'Show demo') {
        sessionsPanel.show(DEMO_SESSIONS, DEMO_LOCKS, `${active.profile.name} (demo preview)`, 'demo');
      }
    }),

    gatedCommand('redlens.datashares', async () => {
      const active = manager.getActive();
      if (active === undefined) {
        void vscode.window.showInformationMessage('RedLens: connect first — datashares/Spectrum read SVV_DATASHARES / SVV_EXTERNAL_*.');
        return;
      }
      if (active.profile.kind === 'demo') {
        sharingPanel.show(DEMO_DATASHARES, DEMO_EXTERNAL_TABLES, active.profile.name, 'demo');
        return;
      }
      const choice = await vscode.window.showInformationMessage('RedLens: datashares & Spectrum need Amazon Redshift. Preview with demo data?', 'Show demo');
      if (choice === 'Show demo') {
        sharingPanel.show(DEMO_DATASHARES, DEMO_EXTERNAL_TABLES, `${active.profile.name} (demo preview)`, 'demo');
      }
    }),
  );
}

function currentSql(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    void vscode.window.showWarningMessage('RedLens: open a .sql editor first.');
    return undefined;
  }
  const selected = editor.document.getText(editor.selection);
  const sql = (selected.trim().length > 0 ? selected : editor.document.getText()).trim();
  if (sql.length === 0) {
    void vscode.window.showWarningMessage('RedLens: nothing to run — the file/selection is empty.');
    return undefined;
  }
  return sql;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
