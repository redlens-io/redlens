import * as vscode from 'vscode';
import { friendlyPgError } from '../ui/connectionWizard';
import { piiColumnIndices, type PiiConfig } from '../pii/piiMask';
import type { ConnectionManager } from '../connections/connectionManager';
import type { GridPanel } from '../ui/gridPanel';
import type { EditableSource } from '../edit/editModel';

export interface RunListener {
  onRunFinished?(sql: string, rowCount: number, durationMs: number): void;
}

/** Maps a result column to the table/column it references (fk-navigation). */
export interface FkColumn {
  columnIndex: number;
  refSchema: string;
  refTable: string;
  refColumn: string;
}

/** Single path for "execute SQL and show it" — editor command, table preview, history re-run. */
export class QueryRunner {
  private readonly listeners: RunListener[] = [];

  /** pii-safe-mode: marks which result columns the grid should mask. */
  getPiiConfig: () => PiiConfig = () => ({ enabled: false, patterns: [] });

  constructor(
    private readonly manager: ConnectionManager,
    private readonly grid: GridPanel,
  ) {}

  addListener(listener: RunListener): void {
    this.listeners.push(listener);
  }

  async run(sql: string, fkColumns: FkColumn[] = [], editable?: EditableSource, silent = false): Promise<boolean> {
    const active = this.manager.getActive();
    if (active === undefined) {
      return false;
    }
    try {
      const executionId = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'RedLens: running query…' },
        () => this.manager.execute(sql),
      );
      const setCount = active.transport.resultSetCount(executionId);
      const datasets = [];
      let primaryRows = 0;
      let primaryMs = 0;
      const piiConfig = this.getPiiConfig();
      for (let setIndex = 0; setIndex < setCount; setIndex++) {
        // Drain all buffered pages of this set so the grid can sort/filter/export it whole.
        const rows: unknown[][] = [];
        let cols: { name: string; typeName: string }[] = [];
        let token: string | undefined;
        do {
          const page = await active.transport.fetchPage(executionId, token, setIndex);
          cols = page.columns;
          rows.push(...page.rows);
          token = page.nextToken;
        } while (token !== undefined);
        const summary = active.transport.getSummary(executionId, setIndex);
        if (setIndex === 0) {
          primaryRows = summary.rowCount;
          primaryMs = summary.durationMs;
        }
        datasets.push({
          columns: cols.map((c) => ({ name: c.name, typeName: c.typeName })),
          rows,
          connectionName: active.profile.name,
          durationMs: summary.durationMs,
          totalRows: summary.rowCount,
          truncated: summary.truncated,
          command: summary.command,
          setLabel: setCount > 1 ? `${summary.command || 'Result'} ${setIndex + 1}` : undefined,
          // Editing only makes sense for a single-table result (setIndex 0).
          editable: setIndex === 0 ? editable : undefined,
          // pii-safe-mode: columns the grid masks (empty when disabled).
          piiColumns: piiColumnIndices(cols, piiConfig),
        });
      }
      if (!silent) {
        this.grid.show(datasets, fkColumns);
      }
      active.transport.releaseResult(executionId);
      for (const l of this.listeners) {
        l.onRunFinished?.(sql, primaryRows, primaryMs);
      }
      return true;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.manager.recordFailure(sql, detail); // smart-error-fix
      void vscode.window.showErrorMessage(`RedLens: query failed — ${friendlyPgError(detail)}`, 'Fix with AI')
        .then((choice) => {
          if (choice === 'Fix with AI') {
            void vscode.commands.executeCommand('redlens.fixLastError');
          }
        });
      return false;
    }
  }
}

/** Double-quote identifier escaping for generated SQL (preview, demo). */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}
