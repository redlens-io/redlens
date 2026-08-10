import * as vscode from 'vscode';
import { gatedCommand } from '../licensing/gate';
import { friendlyPgError, runAddConnectionWizard } from '../ui/connectionWizard';
import type { HostKeyStore } from '../transport/sshTunnel';
import { GridPanel } from '../ui/gridPanel';
import { QueryRunner, quoteIdent } from '../query/runner';
import { QueryHistory } from '../query/history';
import { SavedQueries } from '../query/savedQueries';
import { tableNodeToPreviewArgs } from '../explorer/explorerProvider';
import { detectUnsafe } from '../language/unsafeQuery';
import { extractParams, substituteParams } from '../language/parameters';
import { decideRun } from '../edit/writeGuard';
import { buildChangeSetSql, type ChangeSet } from '../edit/dmlBuilder';
import { readPiiConfig } from '../pii/piiSettings';
import type { EditableSource } from '../edit/editModel';
import { buildCreateTable, buildInsert, buildSelect } from '../scripting/ddl';
import { findMatches } from '../language/findUsages';
import { maskSql } from '../language/sqlText';
import type { FkColumn } from '../query/runner';
import type { ConnectionManager } from '../connections/connectionManager';
import type { ConnectionStore } from '../connections/connectionStore';
import type { ConnectionProfile } from '../connections/profile';
import type { ExplorerProvider } from '../explorer/explorerProvider';
import type { MetadataService } from '../metadata/metadataService';

export function registerCommands(
  context: vscode.ExtensionContext,
  store: ConnectionStore,
  manager: ConnectionManager,
  explorer: ExplorerProvider,
  metadata: MetadataService,
  hostKeys?: HostKeyStore,
): void {
  const grid = new GridPanel(context.extensionUri);
  context.subscriptions.push(grid);
  const runner = new QueryRunner(manager, grid);
  // pii-safe-mode: the grid masks the same columns the MCP bridge does.
  runner.getPiiConfig = readPiiConfig;

  // FK navigation: open the referenced row(s) as a new result.
  grid.onFkNavigate = (fk, value) => {
    const lit = value === null || value === undefined
      ? 'NULL'
      : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
    const pred = lit === 'NULL' ? 'IS NULL' : `= ${lit}`;
    void runner.run(`SELECT * FROM ${quoteIdent(fk.refSchema)}.${quoteIdent(fk.refTable)} WHERE ${quoteIdent(fk.refColumn)} ${pred} LIMIT 100`);
  };
  // inline-data-edit: apply grid edits as a transactional change-set.
  grid.onCommitEdits = (changeSet) => { void commitEdits(changeSet, manager, runner, metadata); };
  const history = new QueryHistory(context.globalState);
  const saved = new SavedQueries(context.globalState);
  runner.addListener({
    onRunFinished: (sql, rowCount, durationMs) => {
      const name = manager.getActive()?.profile.name ?? 'unknown';
      void history.add({ sql, connectionName: name, rowCount, durationMs, at: new Date().toISOString() });
    },
  });

  context.subscriptions.push(
    gatedCommand('redlens.addConnection', async () => {
      const profile = await runAddConnectionWizard(store, hostKeys);
      if (profile !== undefined) {
        await connectTo(profile, store, manager);
      }
    }),

    gatedCommand('redlens.manageConnections', async () => {
      await manageConnections(store, manager);
    }),

    gatedCommand('redlens.connectToProfile', async (profileId: string) => {
      const profile = store.getProfile(profileId);
      if (profile !== undefined) {
        await connectTo(profile, store, manager);
      }
    }),

    gatedCommand('redlens.disconnect', async () => {
      await manager.disconnect();
    }),

    gatedCommand('redlens.toggleReadOnly', () => {
      const active = manager.getActive();
      if (active === undefined) {
        void vscode.window.showInformationMessage('RedLens: connect first.');
        return;
      }
      manager.setFlag('readOnly', !active.readOnly);
      void vscode.window.setStatusBarMessage(`RedLens: connection is now ${active.readOnly ? 'READ-ONLY' : 'writable'}`, 2500);
    }),

    gatedCommand('redlens.toggleProduction', () => {
      const active = manager.getActive();
      if (active === undefined) {
        void vscode.window.showInformationMessage('RedLens: connect first.');
        return;
      }
      manager.setFlag('production', !active.production);
      void vscode.window.setStatusBarMessage(`RedLens: connection ${active.production ? 'marked PRODUCTION' : 'no longer production'}`, 2500);
    }),

    gatedCommand('redlens.toggleAutoCommit', async () => {
      const active = manager.getActive();
      if (active === undefined) {
        void vscode.window.showInformationMessage('RedLens: connect first.');
        return;
      }
      // Turning auto-commit back on with an open transaction → commit it first.
      if (!active.autoCommit && active.inTransaction) {
        await manager.endTransaction('COMMIT');
      }
      manager.setFlag('autoCommit', !active.autoCommit);
      void vscode.window.setStatusBarMessage(
        `RedLens: ${active.autoCommit ? 'auto-commit' : 'manual commit — use Commit / Rollback'}`, 3000);
    }),

    gatedCommand('redlens.commitTransaction', async () => {
      const done = await manager.endTransaction('COMMIT');
      void vscode.window.setStatusBarMessage(done ? 'RedLens: transaction committed' : 'RedLens: no open transaction', 2500);
    }),

    gatedCommand('redlens.rollbackTransaction', async () => {
      const done = await manager.endTransaction('ROLLBACK');
      void vscode.window.setStatusBarMessage(done ? 'RedLens: transaction rolled back' : 'RedLens: no open transaction', 2500);
    }),

    gatedCommand('redlens.togglePiiSafeMode', async () => {
      const cfg = vscode.workspace.getConfiguration('redlens');
      const next = !cfg.get<boolean>('piiSafeMode', false);
      await cfg.update('piiSafeMode', next, vscode.ConfigurationTarget.Global);
      const patterns = cfg.get<string[]>('piiColumns', []);
      // Re-mask any open results immediately (UXD-031) so raw PII does not linger
      // on screen until the next query.
      const applied = grid.refreshPiiMasking();
      void vscode.window.showInformationMessage(
        next
          ? `RedLens: PII-safe mode ON — masking ${patterns.length} pattern(s) in the grid, exports and MCP.${applied ? ' Applied to the open results.' : ' Re-run a query to apply.'}`
          : `RedLens: PII-safe mode OFF.${applied ? ' Open results un-masked.' : ''}`,
      );
    }),

    gatedCommand('redlens.statusBarMenu', async () => {
      // Makes the status-bar flags actionable (UXD-015): a QuickPick that shows
      // each toggle's current on/off state and flips it on selection.
      const active = manager.getActive();
      const pii = vscode.workspace.getConfiguration('redlens').get<boolean>('piiSafeMode', false);
      const mark = (on: boolean): string => (on ? '$(check)' : '$(circle-large-outline)');
      const items: (vscode.QuickPickItem & { action: string })[] = [];
      if (active !== undefined) {
        items.push({ label: `${mark(active.readOnly)} Read-only`, description: active.readOnly ? 'on' : 'off', action: 'readOnly' });
        items.push({ label: `${mark(active.production)} Production safeguard`, description: active.production ? 'on' : 'off', action: 'production' });
        items.push({ label: `${mark(active.autoCommit)} Auto-commit`, description: active.autoCommit ? 'on' : 'off', action: 'autoCommit' });
      }
      items.push({ label: `${mark(pii)} PII-safe mode`, description: pii ? 'on' : 'off', action: 'pii' });
      items.push({ label: '$(gear) Manage connections…', action: 'manage' });
      const picked = await vscode.window.showQuickPick(items, { title: 'RedLens: status & toggles' });
      if (picked === undefined) return;
      const cmd: Record<string, string> = {
        readOnly: 'redlens.toggleReadOnly', production: 'redlens.toggleProduction',
        autoCommit: 'redlens.toggleAutoCommit', pii: 'redlens.togglePiiSafeMode', manage: 'redlens.manageConnections',
      };
      await vscode.commands.executeCommand(cmd[picked.action]!);
    }),

    gatedCommand('redlens.cancelQuery', async () => {
      try {
        await manager.cancelRunning();
        void vscode.window.showInformationMessage('RedLens: cancellation requested.');
      } catch (err) {
        void vscode.window.showErrorMessage(`RedLens: could not cancel — ${message(err)}`);
      }
    }),

    gatedCommand('redlens.runQuery', async () => {
      await runFromEditor(store, manager, runner);
    }),

    gatedCommand('redlens.refreshExplorer', () => {
      explorer.refresh();
    }),

    gatedCommand('redlens.editTableData', () => {
      if (!grid.toggleEdit()) {
        void vscode.window.showInformationMessage('RedLens: open a table (Preview Table) first, then edit its data.');
      }
    }),

    gatedCommand('redlens.chartResults', () => {
      if (!grid.toggleChart()) {
        void vscode.window.showInformationMessage('RedLens: run a query with numeric columns first, then chart it.');
      }
    }),

    gatedCommand('redlens.toggleHeatmap', () => {
      if (!grid.toggleHeatmap()) {
        void vscode.window.showInformationMessage('RedLens: open a result grid first.');
      }
    }),

    gatedCommand('redlens.transposeResults', () => {
      if (!grid.toggleTranspose()) {
        void vscode.window.showInformationMessage('RedLens: open a result grid first.');
      }
    }),

    // Internal (shots/programmatic): group the open grid by a column index.
    gatedCommand('redlens.groupResults', (column: number) => {
      grid.setGroup(typeof column === 'number' ? column : 0);
    }),

    gatedCommand('redlens.pinBaseline', () => {
      if (!grid.pinBaseline()) {
        void vscode.window.showInformationMessage('RedLens: open a result grid first.');
      }
    }),

    gatedCommand('redlens.compareResults', () => {
      if (!grid.toggleCompare()) {
        void vscode.window.showInformationMessage('RedLens: open a result grid first.');
      }
    }),

    gatedCommand('redlens.pasteRowsIntoGrid', async () => {
      const text = await vscode.env.clipboard.readText();
      if (text.trim().length === 0) {
        void vscode.window.showInformationMessage('RedLens: clipboard is empty — copy some CSV/TSV rows first.');
        return;
      }
      if (!grid.pasteRows(text)) {
        void vscode.window.showInformationMessage('RedLens: open an editable table (Preview Table) first.');
      }
    }),

    // Internal: apply a change-set the grid webview built (inline-data-edit).
    gatedCommand('redlens.commitGridEdits', async (changeSet: ChangeSet) => {
      await commitEdits(changeSet, manager, runner, metadata);
    }),

    gatedCommand('redlens.previewTable', async (node: unknown) => {
      const args = tableNodeToPreviewArgs(node);
      if (args === undefined) {
        return;
      }
      await previewTableEditable(metadata, runner, args.schema, args.table);
    }),

    gatedCommand('redlens.showHistory', async () => {
      const entries = history.list();
      if (entries.length === 0) {
        void vscode.window.showInformationMessage('RedLens: no queries in history yet — run one with Ctrl+Enter.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        entries.map((e) => ({
          label: e.sql.length > 80 ? `${e.sql.slice(0, 77)}…` : e.sql,
          description: `${e.rowCount} rows · ${e.durationMs} ms · ${e.connectionName}`,
          detail: new Date(e.at).toLocaleString(),
          sql: e.sql,
        })),
        { title: 'RedLens: Query History', placeHolder: 'Pick a query to open it in a new editor' },
      );
      if (picked !== undefined) {
        const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: picked.sql });
        await vscode.window.showTextDocument(doc);
      }
    }),

    gatedCommand('redlens.saveQuery', async () => {
      const editor = vscode.window.activeTextEditor;
      const sql = editor ? resolveExecutionSql(editor.document, editor.selection).trim() : '';
      if (sql.length === 0) {
        void vscode.window.showWarningMessage('RedLens: open a .sql editor with a query to save.');
        return;
      }
      const name = await vscode.window.showInputBox({ title: 'RedLens: bookmark name', ignoreFocusOut: true, placeHolder: 'daily-sales-check' });
      if (name === undefined || name.trim().length === 0) {
        return;
      }
      await saved.save(name.trim(), sql, new Date().toISOString());
      void vscode.window.showInformationMessage(`RedLens: saved query "${name.trim()}".`);
    }),

    gatedCommand('redlens.openSavedQuery', async () => {
      const queries = saved.list();
      if (queries.length === 0) {
        void vscode.window.showInformationMessage('RedLens: no saved queries yet — use "Save Query as Bookmark".');
        return;
      }
      type Item = vscode.QuickPickItem & { sql?: string; del?: string };
      const items: Item[] = queries.map((q) => ({
        label: `$(bookmark) ${q.name}`,
        description: q.sql.length > 70 ? `${q.sql.slice(0, 67)}…` : q.sql,
        detail: new Date(q.at).toLocaleString(),
        sql: q.sql,
      }));
      items.push(...queries.map((q) => ({ label: `$(trash) Delete "${q.name}"`, del: q.name })));
      const picked = await vscode.window.showQuickPick(items, { title: 'RedLens: Saved Queries' });
      if (picked === undefined) {
        return;
      }
      if (picked.del !== undefined) {
        // Confirm before an irreversible delete (UXD-012) — one mis-highlight +
        // Enter used to delete a saved query with no undo.
        const confirm = await vscode.window.showWarningMessage(
          `RedLens: delete saved query "${picked.del}"? This cannot be undone.`, { modal: true }, 'Delete',
        );
        if (confirm !== 'Delete') { return; }
        await saved.remove(picked.del);
        void vscode.window.showInformationMessage(`RedLens: deleted "${picked.del}".`);
      } else if (picked.sql !== undefined) {
        const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: picked.sql });
        await vscode.window.showTextDocument(doc);
      }
    }),

    gatedCommand('redlens.searchObjects', async () => {
      if (manager.getActive() === undefined) {
        void vscode.window.showInformationMessage('RedLens: connect first to search objects.');
        return;
      }
      type Item = vscode.QuickPickItem & { schema: string; table: string };
      const items: Item[] = [];
      const schemas = await metadata.listSchemas();
      for (const schema of schemas) {
        for (const t of await metadata.listTables(schema)) {
          items.push({ label: `$(table) ${schema}.${t.name}`, description: t.kind, schema, table: t.name });
        }
      }
      if (items.length === 0) { // avoid a dead-end empty picker (UXD-013)
        void vscode.window.showInformationMessage('RedLens: no tables or views found in this connection.');
        return;
      }
      const picked = await vscode.window.showQuickPick(items, {
        title: 'RedLens: Go to Table',
        placeHolder: 'Type to filter tables/views across all schemas',
        matchOnDescription: true,
      });
      if (picked !== undefined) {
        await vscode.commands.executeCommand('redlens.previewTable', {
          type: 'table',
          table: { schema: picked.schema, name: picked.table, kind: 'table' },
        });
      }
    }),

    gatedCommand('redlens.scriptObject', async (node: unknown) => {
      const args = tableNodeToPreviewArgs(node);
      if (args === undefined) {
        return;
      }
      const kind = await vscode.window.showQuickPick(
        [
          { label: '$(file-code) Script as CREATE TABLE', value: 'create' as const },
          { label: '$(search) Script as SELECT', value: 'select' as const },
          { label: '$(add) Script as INSERT', value: 'insert' as const },
        ],
        { title: `RedLens: script ${args.schema}.${args.table}` },
      );
      if (kind === undefined) {
        return;
      }
      const columns = (await metadata.listColumns(args.schema, args.table)).map((c) => ({
        name: c.name, typeName: c.typeName, nullable: c.nullable,
      }));
      const sql = kind.value === 'create' ? buildCreateTable(args.schema, args.table, columns)
        : kind.value === 'select' ? buildSelect(args.schema, args.table, columns)
        : buildInsert(args.schema, args.table, columns);
      const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: sql + '\n' });
      await vscode.window.showTextDocument(doc);
    }),

    gatedCommand('redlens.findUsages', async () => {
      const editor = vscode.window.activeTextEditor;
      const selected = editor?.document.getText(editor.selection).trim();
      const term = selected && selected.length > 0
        ? selected
        : await vscode.window.showInputBox({ title: 'RedLens: find usages of…', placeHolder: 'tickit.sales or eventid', ignoreFocusOut: true });
      if (term === undefined || term.trim().length === 0) {
        return;
      }
      const files = await vscode.workspace.findFiles('**/*.sql', '**/node_modules/**', 500);
      type Hit = vscode.QuickPickItem & { uri: vscode.Uri; line: number; column: number };
      const hits: Hit[] = [];
      for (const uri of files) {
        const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        // Match on masked text so occurrences inside string literals/comments
        // aren't counted as usages (UXD-045); maskSql is length-preserving so the
        // line/column stay valid. Show the ORIGINAL line, not the masked one.
        const originalLines = text.split('\n');
        for (const m of findMatches(maskSql(text), term.trim())) {
          const lineText = originalLines[m.line] ?? m.lineText;
          hits.push({
            label: lineText.length > 80 ? `${lineText.slice(0, 77)}…` : lineText,
            description: `${vscode.workspace.asRelativePath(uri)}:${m.line + 1}`,
            uri, line: m.line, column: m.column,
          });
        }
      }
      if (hits.length === 0) {
        void vscode.window.showInformationMessage(`RedLens: no usages of "${term.trim()}" found in .sql files.`);
        return;
      }
      const picked = await vscode.window.showQuickPick(hits, { title: `RedLens: ${hits.length} usage(s) of "${term.trim()}"` });
      if (picked !== undefined) {
        const doc = await vscode.workspace.openTextDocument(picked.uri);
        const ed = await vscode.window.showTextDocument(doc);
        const pos = new vscode.Position(picked.line, picked.column);
        ed.selection = new vscode.Selection(pos, pos);
        ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    }),
  );
}

async function manageConnections(store: ConnectionStore, manager: ConnectionManager): Promise<void> {
  const profiles = store.getProfiles();
  const active = manager.getActive();

  type Item = vscode.QuickPickItem & { action: 'connect' | 'add' | 'disconnect' | 'delete'; profile?: ConnectionProfile };
  const items: Item[] = profiles.map((p) => ({
    label: `${p.id === active?.profile.id ? '$(check) ' : '$(database) '}${p.name}`,
    description: p.kind === 'demo' ? 'demo (fixtures)' : `${p.host}:${p.port}/${p.database}`,
    action: 'connect' as const,
    profile: p,
  }));
  items.push({ label: '$(add) Add new connection…', action: 'add' });
  if (active !== undefined) {
    items.push({ label: '$(debug-disconnect) Disconnect', description: active.profile.name, action: 'disconnect' });
  }
  if (profiles.length > 0) {
    items.push({ label: '$(trash) Delete a connection…', action: 'delete' });
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: 'RedLens Connections',
    placeHolder: profiles.length === 0 ? 'No connections yet — add your first one' : 'Pick a connection',
  });
  if (picked === undefined) {
    return;
  }
  switch (picked.action) {
    case 'add':
      await vscode.commands.executeCommand('redlens.addConnection');
      return;
    case 'disconnect':
      await manager.disconnect();
      return;
    case 'connect':
      if (picked.profile !== undefined) {
        await connectTo(picked.profile, store, manager);
      }
      return;
    case 'delete': {
      const toDelete = await vscode.window.showQuickPick(
        profiles.map((p) => ({ label: p.name, description: `${p.host}:${p.port}`, id: p.id })),
        { title: 'RedLens: delete which connection?' },
      );
      if (toDelete !== undefined) {
        if (active?.profile.id === toDelete.id) {
          await manager.disconnect();
        }
        await store.deleteProfile(toDelete.id);
        void vscode.window.showInformationMessage(`RedLens: deleted "${toDelete.label}".`);
      }
      return;
    }
  }
}

async function connectTo(profile: ConnectionProfile, store: ConnectionStore, manager: ConnectionManager): Promise<void> {
  let password = '';
  // Only persist a freshly-typed password AFTER a successful connect (UXD-011):
  // saving it first meant a wrong password got stored and silently reused, so
  // the user could never recover without deleting the profile.
  let freshPassword = false;
  if (profile.kind !== 'demo') {
    const stored = await store.getPassword(profile.id);
    if (stored !== undefined) {
      password = stored;
    } else {
      const entered = await vscode.window.showInputBox({
        title: `RedLens: password for ${profile.name}`,
        password: true,
        ignoreFocusOut: true,
      });
      if (entered === undefined) {
        return;
      }
      password = entered;
      freshPassword = true;
    }
  }
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `RedLens: connecting to ${profile.name}…` },
      () => manager.connect(profile, password),
    );
    if (freshPassword) {
      await store.saveProfile(profile, password); // persist only on success
    }
  } catch (err) {
    void vscode.window.showErrorMessage(`RedLens: connection failed — ${friendlyPgError(message(err))}`);
  }
}

export function resolveExecutionSql(document: { getText(range?: vscode.Range): string }, selection: vscode.Selection): string {
  const selected = document.getText(selection);
  return selected.trim().length > 0 ? selected : document.getText();
}

async function runFromEditor(store: ConnectionStore, manager: ConnectionManager, runner: QueryRunner): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    void vscode.window.showWarningMessage('RedLens: open a .sql file (or any editor with SQL) and try again.');
    return;
  }
  const sql = resolveExecutionSql(editor.document, editor.selection).trim();
  if (sql.length === 0) {
    void vscode.window.showWarningMessage('RedLens: nothing to run — the file/selection is empty.');
    return;
  }

  // Empty state that teaches (§7.5 #4): no connection → offer the fix inline.
  if (manager.getActive() === undefined) {
    const choice = await vscode.window.showInformationMessage(
      'RedLens: no active connection.',
      'Connect…',
      'Add connection…',
    );
    if (choice === 'Connect…') {
      await manageConnections(store, manager);
    } else if (choice === 'Add connection…') {
      await vscode.commands.executeCommand('redlens.addConnection');
    }
    if (manager.getActive() === undefined) {
      return;
    }
  }
  // parameterized-queries: prompt for :name placeholders, then substitute.
  const params = extractParams(sql);
  let finalSql = sql;
  if (params.length > 0) {
    const values: Record<string, string> = {};
    for (const name of params) {
      const value = await vscode.window.showInputBox({ title: `RedLens: value for :${name}`, ignoreFocusOut: true });
      if (value === undefined) {
        return;
      }
      values[name] = value;
    }
    finalSql = substituteParams(sql, values);
  }

  // read-only-toggle / prod-safeguard: block or confirm writes per connection flags.
  const active = manager.getActive();
  if (active !== undefined) {
    const decision = decideRun(finalSql, { readOnly: active.readOnly, production: active.production });
    if (!decision.allow) {
      void vscode.window.showErrorMessage(`RedLens: ${decision.reason}. Toggle it off with "RedLens: Toggle Read-Only".`);
      return;
    }
    if (decision.needsConfirm) {
      // Show the exact statement in the modal detail so the confirm is informed,
      // not a blind Enter (UXD-029). VS Code always renders Cancel; Escape aborts.
      const preview = finalSql.length > 400 ? `${finalSql.slice(0, 400)}…` : finalSql;
      const ok = await vscode.window.showWarningMessage(
        `RedLens: ${decision.reason}. Run this write anyway?`,
        { modal: true, detail: preview }, 'Run',
      );
      if (ok !== 'Run') {
        return;
      }
    }
  }

  // unsafe-query-warning: confirm destructive statements before running.
  const verdict = detectUnsafe(finalSql);
  if (verdict.unsafe) {
    const choice = await vscode.window.showWarningMessage(
      `RedLens: ${verdict.reason}. Run anyway?`,
      { modal: true },
      'Run',
    );
    if (choice !== 'Run') {
      return;
    }
  }
  // transaction-control: in manual-commit mode, open a transaction first so the
  // query runs inside it (the user later Commits or Rolls back).
  await manager.beginIfManual();
  await runner.run(finalSql);
}

/**
 * Preview a base table as an EDITABLE result: SELECT * plus FK columns (for
 * navigation) plus the primary key (so the grid can build DML). A table with no
 * PK is previewed read-only (editing needs a key to target rows safely).
 */
async function previewTableEditable(
  metadata: MetadataService,
  runner: QueryRunner,
  schema: string,
  table: string,
): Promise<void> {
  const [columns, fks, pk] = await Promise.all([
    metadata.listColumns(schema, table),
    metadata.listForeignKeys(schema, table),
    metadata.listPrimaryKey(schema, table),
  ]);
  const fkColumns: FkColumn[] = fks.flatMap((fk) => {
    const columnIndex = columns.findIndex((c) => c.name === fk.column);
    return columnIndex >= 0
      ? [{ columnIndex, refSchema: fk.refSchema, refTable: fk.refTable, refColumn: fk.refColumn }]
      : [];
  });
  const editable: EditableSource | undefined = pk.length > 0 ? { schema, table, pkColumns: pk } : undefined;
  await runner.run(`SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)} LIMIT 100`, fkColumns, editable);
}

/**
 * inline-data-edit / dml-preview: turn a grid change-set into transactional
 * DML, preview it, confirm, run it, and refresh the table. Reuses the
 * read-only guard so edits can't slip past a read-only connection.
 */
async function commitEdits(
  changeSet: ChangeSet,
  manager: ConnectionManager,
  runner: QueryRunner,
  metadata: MetadataService,
): Promise<void> {
  const sql = buildChangeSetSql(changeSet);
  if (sql.startsWith('-- no pending')) {
    void vscode.window.showInformationMessage('RedLens: no pending changes to apply.');
    return;
  }
  const active = manager.getActive();
  if (active === undefined) {
    void vscode.window.showInformationMessage('RedLens: connect first.');
    return;
  }
  // read-only-toggle: a read-only connection blocks the commit outright.
  const decision = decideRun(sql, { readOnly: active.readOnly, production: active.production });
  if (!decision.allow) {
    void vscode.window.showErrorMessage(`RedLens: ${decision.reason}. Toggle it off with "RedLens: Toggle Read-Only".`);
    return;
  }
  const n = changeSet.updates.length + changeSet.inserts.length + changeSet.deletes.length;
  const prodNote = active.production ? '\n\n⚠ This connection is marked PRODUCTION.' : '';
  // dml-preview: show the exact SQL and require an explicit confirmation.
  const ok = await vscode.window.showWarningMessage(
    `RedLens: apply ${n} change(s) to ${changeSet.table}?`,
    { modal: true, detail: sql + prodNote },
    'Apply',
  );
  if (ok !== 'Apply') {
    return;
  }
  const success = await runner.run(sql, [], undefined, true);
  if (success) {
    void vscode.window.setStatusBarMessage(`RedLens: applied ${n} change(s) to ${changeSet.table}`, 3000);
    // Reflect the committed state and clear the edit buffer.
    const src = changeSet.table.replace(/"/g, '').split('.');
    if (src.length === 2) {
      await previewTableEditable(metadata, runner, src[0]!, src[1]!);
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
