import * as vscode from 'vscode';
import { gatedCommand } from '../licensing/gate';
import { decodeNotebook, encodeNotebook, resultToMarkdown, type RawCell } from './notebookModel';
import { queryAll } from '../query/collect';
import { decideRun } from '../edit/writeGuard';
import { detectUnsafe } from '../language/unsafeQuery';
import { maskRows } from '../pii/piiMask';
import { readPiiConfig } from '../pii/piiSettings';
import { friendlyPgError } from '../ui/connectionWizard';
import type { ConnectionManager } from '../connections/connectionManager';

export const NOTEBOOK_TYPE = 'redlens-sql';

/** sql-notebooks (M5): a VS Code notebook of SQL cells that run against the
 * active RedLens connection. `.rlnb` files serialize as JSON via the pure model. */
const serializer: vscode.NotebookSerializer = {
  deserializeNotebook(content: Uint8Array): vscode.NotebookData {
    const text = new TextDecoder().decode(content);
    const cells = decodeNotebook(text).map((c) =>
      new vscode.NotebookCellData(
        c.kind === 'markup' ? vscode.NotebookCellKind.Markup : vscode.NotebookCellKind.Code,
        c.value,
        c.language,
      ));
    return new vscode.NotebookData(cells);
  },
  serializeNotebook(data: vscode.NotebookData): Uint8Array {
    const cells: RawCell[] = data.cells.map((c) => ({
      kind: c.kind === vscode.NotebookCellKind.Markup ? 'markup' : 'code',
      value: c.value,
      language: c.languageId,
    }));
    return new TextEncoder().encode(encodeNotebook(cells));
  },
};

export function registerNotebook(context: vscode.ExtensionContext, manager: ConnectionManager): void {
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(NOTEBOOK_TYPE, serializer),
  );

  const controller = vscode.notebooks.createNotebookController(
    'redlens-sql-runner',
    NOTEBOOK_TYPE,
    'RedLens (active connection)',
  );
  controller.supportedLanguages = ['sql'];
  controller.supportsExecutionOrder = true;
  controller.description = 'Runs SQL cells on the active RedLens connection';
  controller.executeHandler = async (cells) => {
    for (const cell of cells) {
      await runCell(cell, controller, manager);
    }
  };
  // Pressing the cell's stop button cancels the in-flight query (UXD-017) — was a
  // no-op before, leaving a long query running with no way to stop it.
  controller.interruptHandler = async () => {
    try {
      await manager.cancelRunning();
    } catch {
      /* nothing running / not cancellable */
    }
  };
  context.subscriptions.push(controller);

  context.subscriptions.push(
    gatedCommand('redlens.newNotebook', async () => {
      const data = new vscode.NotebookData([
        new vscode.NotebookCellData(
          vscode.NotebookCellKind.Markup,
          '# RedLens SQL Notebook\n\nCells run against the **active connection**. Press ▷ (or Ctrl+Enter) on a SQL cell.',
          'markdown',
        ),
        new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'SELECT * FROM tickit.venue LIMIT 5;', 'sql'),
      ]);
      const nb = await vscode.workspace.openNotebookDocument(NOTEBOOK_TYPE, data);
      await vscode.window.showNotebookDocument(nb);
    }),
  );
}

async function confirmModal(message: string): Promise<boolean> {
  const ok = await vscode.window.showWarningMessage(message, { modal: true }, 'Run');
  return ok === 'Run';
}

function note(markdown: string): vscode.NotebookCellOutput {
  return new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(markdown, 'text/markdown')]);
}

// Per-notebook execution counter (UXD-040): a global monotonic counter made a
// notebook's first cell display as e.g. [37] across reopens/other documents.
const orderByNotebook = new WeakMap<vscode.NotebookDocument, number>();

async function runCell(
  cell: vscode.NotebookCell,
  controller: vscode.NotebookController,
  manager: ConnectionManager,
): Promise<void> {
  const exec = controller.createNotebookCellExecution(cell);
  const next = (orderByNotebook.get(cell.notebook) ?? 0) + 1;
  orderByNotebook.set(cell.notebook, next);
  exec.executionOrder = next;
  exec.start(Date.now());
  const sql = cell.document.getText().trim();
  if (sql === '') {
    exec.replaceOutput([]);
    exec.end(true, Date.now());
    return;
  }
  try {
    const active = manager.getActive();
    if (active === undefined) {
      throw new Error('No active RedLens connection — connect one first (status bar → RedLens: Connect).');
    }
    // read-only-toggle / prod-safeguard: block writes on a read-only connection,
    // and require an explicit confirm on a production connection — same guards
    // the editor run path enforces, so a notebook cell can't bypass them.
    const decision = decideRun(sql, { readOnly: active.readOnly, production: active.production });
    if (!decision.allow) {
      throw new Error(`${decision.reason}.`);
    }
    if (decision.needsConfirm && !(await confirmModal(`RedLens: ${decision.reason}. Run this write anyway?`))) {
      exec.replaceOutput([note('_cancelled — production write not run_')]);
      exec.end(true, Date.now());
      return;
    }
    // unsafe-query-warning: confirm destructive statements before running.
    const verdict = detectUnsafe(sql);
    if (verdict.unsafe && !(await confirmModal(`RedLens: ${verdict.reason}. Run anyway?`))) {
      exec.replaceOutput([note('_cancelled — unsafe statement not run_')]);
      exec.end(true, Date.now());
      return;
    }
    // transaction-control: in manual-commit mode open a transaction so the write
    // is rollback-able, mirroring the editor path.
    await manager.beginIfManual();
    const started = Date.now();
    const { columns, rows } = await queryAll(active.transport, sql);
    const durationMs = Date.now() - started;
    // pii-safe-mode: mask configured columns in the notebook output too.
    const masked = maskRows(columns, rows, readPiiConfig());
    const md = resultToMarkdown(columns, masked, { rowCount: rows.length, durationMs, truncated: false });
    exec.replaceOutput([new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(md, 'text/markdown')])]);
    exec.end(true, Date.now());
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const e = new Error(friendlyPgError(detail));
    exec.replaceOutput([new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(e)])]);
    exec.end(false, Date.now());
  }
}
