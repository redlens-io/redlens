import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/**
 * Screenshot suite for the user manual (docs/MANUAL-DE-USO.md): drives the
 * demo connection inside the headless VS Code and captures the Xvfb display
 * with imagemagick at key moments. Deterministic fixtures → reproducible docs.
 * NEVER awaits interactive commands (QuickPick) — fire, sleep, capture, close.
 */

const OUT_DIR = '/app/docs/manual/img';

/**
 * Take the shot, after clearing everything that is not this product.
 *
 * The tidying lives HERE, in the shutter itself, because doing it once at
 * startup was not enough and the difference is invisible until you look at the
 * images: the host's notifications ("extensions are temporarily disabled", "not
 * recommended to run Code as root") arrive during activation, and the chat
 * sidebar and PROBLEMS panel come back on their own as panels open. Most of the
 * batch carried at least one of them.
 *
 * `keepNotices` is for the handful of captures where a notification IS the
 * subject — the write-safety ones exist to show that RedLens refuses the write
 * and says so. Clearing it there would photograph the absence of the feature.
 */
async function capture(name: string, opts: { keepNotices?: boolean } = {}): Promise<void> {
  await tryCommand('workbench.action.closeAuxiliaryBar');
  await tryCommand('workbench.action.closePanel');
  if (opts.keepNotices !== true) {
    await tryCommand('notifications.clearAll');
  }
  await sleep(350);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  execSync(`import -window root ${path.join(OUT_DIR, name)}`, { env: process.env });
  console.error(`captured ${name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a command that may not exist in this workbench, and say so if it does not.
 *
 * The governance capture spent a release showing a collapsed tree because its
 * expand call was wrapped in a bare `catch {}`: the command was never available,
 * nothing said so, and the screenshot published the failure. A swallowed error
 * in a screenshot harness does not produce a missing image — it produces a
 * WRONG one, which is far harder to notice.
 */
async function tryCommand(id: string, ...args: unknown[]): Promise<boolean> {
  try {
    await vscode.commands.executeCommand(id, ...args);
    return true;
  } catch (err) {
    console.error(`shots: '${id}' did not run — ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Captures this run could not take, and why. Printed at the end. */
const skipped: string[] = [];

/**
 * Capture a panel that belongs to RedLens Pro.
 *
 * This harness lives in the free package and runs it standalone, so the paid
 * commands are simply absent unless Pro happens to be loaded alongside. Calling
 * them unguarded aborted the whole run at the first one — which is how the
 * screenshot suite came to be red since the open-core split, taking every
 * capture after it down with it, including ones that had nothing to do with Pro.
 *
 * Skipping is right here, but silence is not: the point of a screenshot suite is
 * the images it produces, so an image it did not produce has to be said out
 * loud, at the end, where it cannot be lost in the scrollback.
 */
async function proCapture(command: string, name: string, ...args: unknown[]): Promise<boolean> {
  if (!(await tryCommand(command, ...args))) {
    skipped.push(`${name} (needs RedLens Pro — '${command}' is not registered)`);
    return false;
  }
  await sleep(2500);
  await capture(name);
  return true;
}

/** Put the workbench in a state worth photographing. */
async function quiet(): Promise<void> {
  // The chat sidebar is the host's, not ours, and it is a quarter of the width.
  await tryCommand('workbench.action.closeAuxiliaryBar');
  // The panel (PROBLEMS/OUTPUT) took half the height of two published shots.
  await tryCommand('workbench.action.closePanel');
  await tryCommand('notifications.clearAll');
  await sleep(400);
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension('lensql.redlens');
  if (ext === undefined) {
    throw new Error('extension not found');
  }
  await ext.activate();

  // Seed a demo profile straight into settings (no secrets needed for demo).
  const demoProfile = {
    id: 'demoshots',
    name: 'Demo (tickit fixtures)',
    kind: 'demo',
    host: 'demo',
    port: 1,
    database: 'tickit',
    username: 'demo',
    ssl: false,
  };
  await vscode.workspace.getConfiguration('redlens').update('connections', [demoProfile], vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('redlens.connectToProfile', 'demoshots');
  await sleep(500);

  // Clear the workbench of everything that is not RedLens before anything is
  // captured. None of it belongs in a screenshot of this product: the chat
  // sidebar eats a quarter of the width in every shot that reaches the editor,
  // and the host's own notifications ("extensions are temporarily disabled",
  // "not recommended to run Code as root") sit on top of the content.
  //
  // Cropping can remove the window chrome afterwards, because chrome is outside
  // the product. These are inside it, so they have to go before the capture,
  // not after.
  await quiet();

  // 1) Explorer with the demo warehouse.
  await vscode.commands.executeCommand('workbench.view.extension.redlens');
  await sleep(2500);
  await capture('01-explorador-demo.png');

  // 1a-bis) M9b4 Tools view: the catalog grouped by intent, Query pre-expanded.
  await vscode.commands.executeCommand('redlensTools.focus');
  await sleep(1500);
  await capture('33-tools-view.png');

  // 1b) M8b1 governance tree: Schemas / Datashares / Users & Roles / Security
  //     policies. The point of this capture is the three sections BELOW
  //     Schemas — datashares, users and roles, and row-level security — because
  //     those are what the incumbents do not show at all. A capture with them
  //     collapsed proves nothing, which is exactly what the previous one did.
  //
  //     `list.expandAll` is gated on `listFocus`, and focusing the *view* is not
  //     the same as focusing the list inside it: the list has no focused element
  //     until something puts one there. `list.focusFirst` is what does that, and
  //     without it the expand silently never ran.
  //
  //     The privileges viewer goes in the editor beside it, because a picture of
  //     a sidebar is not an argument. Together they are: the tree finds the
  //     datashares, users, roles and policies, and the panel answers "who can do
  //     what" on one of them — the two halves of the gap this product is
  //     claiming against the incumbents. Both are Free, so the image shows what
  //     someone gets before paying anything.
  await vscode.commands.executeCommand('redlens.showPrivileges', {
    type: 'table',
    table: { schema: 'tickit', name: 'sales', kind: 'table' },
  });
  await sleep(2000);
  await vscode.commands.executeCommand('redlensExplorer.focus');
  await sleep(600);
  await tryCommand('list.focusFirst');
  await sleep(200);
  if (!(await tryCommand('list.expandAll'))) {
    // `list.expandAll` does not exist in this workbench — confirmed, not
    // assumed. Walk the list instead: focus a row, expand it, move down.
    for (let i = 0; i < 12; i++) {
      await tryCommand('list.expand');
      await tryCommand('list.focusDown');
    }
    // Walking scrolls, and the walk ends at the bottom, which cropped the top of
    // the tree out of frame. Go back to the top.
    await tryCommand('list.focusFirst');
    // Then collapse Schemas, which `focusFirst` has just landed on. Expanded, it
    // fills the view with tickit's tables and pushes Datashares, Users & Roles
    // and Security policies below the fold — and those three are the whole
    // reason this capture exists. Schemas stays visible as a header, so the shot
    // still shows all four sections; only the one that is not the subject gives
    // up its space.
    await tryCommand('list.collapse');
  }
  await sleep(1000);
  // Immediately before the shutter, not only at startup: the host's own
  // notifications ("extensions are temporarily disabled", "not recommended to
  // run Code as root") arrive during activation, after the first clear.
  await quiet();
  await capture('30-gobernanza-arbol.png');
  // Close it again. A capture must leave the workbench as it found it: this
  // panel is an extra editor tab, and leaving it open re-columned every shot
  // that came after — the SQL editor lost a third of its width in `editor.png`
  // without a single line of that capture changing. Setup that leaks forward is
  // how a screenshot suite quietly rots.
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await sleep(400);

  // 2) Table preview → interactive grid. tickit.sales has an FK on eventid,
  //    so the grid shows the 🔗 marker (fk-navigation).
  await vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table',
    table: { schema: 'tickit', name: 'sales', kind: 'table' },
  });
  await sleep(2500);
  await capture('02-preview-resultados.png');
  // Note: multiple-result-sets (tabbed grid) needs multi-statement SQL, which
  // demo mode does not run; it is validated by the live pg-compat test instead
  // (tests/pgWire.live.test.ts). fk-navigation shows as the 🔗 marker on
  // tickit.sales.eventid in the preview above.

  // 3) SQL editor with a query ready to run.
  const doc = await vscode.workspace.openTextDocument({
    language: 'sql',
    content: 'SELECT * FROM tickit.sales LIMIT 25;\n',
  });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
  await sleep(1500);
  await capture('03-editor-sql.png');

  // 4) Connections QuickPick (fire WITHOUT awaiting — it blocks for input).
  void vscode.commands.executeCommand('redlens.manageConnections');
  await sleep(1800);
  await capture('04-conexiones.png');
  await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
  await sleep(400);

  // 5) EXPLAIN visualizer (demo plan for a join → broadcast warning).
  const planDoc = await vscode.workspace.openTextDocument({
    language: 'sql',
    content: 'SELECT e.eventname, sum(s.pricepaid)\nFROM tickit.sales s JOIN tickit.event e ON e.eventid = s.eventid\nGROUP BY e.eventname;\n',
  });
  await vscode.window.showTextDocument(planDoc, vscode.ViewColumn.One);
  await sleep(600);
  await vscode.commands.executeCommand('redlens.explainQuery');
  await sleep(2500);
  await capture('05-explain-plan.png');

  // 6) Performance dashboard (demo SYS_* fixtures + demo CloudWatch cards).
  const dashboardOpen = await proCapture('redlens.showDashboard', '06-dashboard.png');

  // 6a) The same panel maximized: the CloudWatch infrastructure row only reads
  //     as a row when the editor is wide, and that row is the point of M10b1.
  //
  //     Guarded on the dashboard having actually opened. Without the guard this
  //     capture still fired with no dashboard in the editor and overwrote a good
  //     asset with a photograph of an empty SQL tab — a skipped capture leaves a
  //     stale file, which is recoverable, but one that fires against the wrong
  //     screen publishes a lie.
  if (dashboardOpen) {
    await vscode.commands.executeCommand('workbench.action.closeEditorsInOtherGroups');
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await sleep(1800);
    await quiet();
    await capture('37-cloudwatch-metrics.png');
    await vscode.commands.executeCommand('workbench.action.focusSideBar');
    await sleep(600);
  } else {
    skipped.push("37-cloudwatch-metrics.png (needs the dashboard from RedLens Pro)");
  }

  // 6b) Cluster view (M10b2): the console's configuration, read-only. Two shots
  //     because the two payoffs are different — the properties page, and the
  //     parameters page where non-default values are called out.
  try {
    await vscode.commands.executeCommand('redlensCluster.focus');
  } catch {
    /* headless workbench may not expose the focus command */
  }
  await sleep(600);
  await vscode.commands.executeCommand('redlens.showCluster');
  await sleep(2000);
  await capture('38-cluster-properties.png');

  await vscode.commands.executeCommand('redlens.cluster.showSection', 'parameters');
  await sleep(2000);
  await capture('39-cluster-parameters.png');

  // 6c) Backups (M10b3): snapshots next to the 30-minute recovery points, which
  //     is the pairing people get wrong about Serverless.
  await vscode.commands.executeCommand('redlens.cluster.showSection', 'snapshots');
  await sleep(2000);
  await capture('40-cluster-snapshots.png');

  // 6d) The licence screen used to be captured here (41-licence.png). It moved
  //     out with the Fase O split: `redlens.manageLicense` belongs to the Pro
  //     extension now, and this runner only ever loads the base. Capturing it
  //     from here would mean either shipping licensing back into the open
  //     package or photographing a command that is not registered.

  // 6h) Table optimization advisor (skew / vacuum-analyze / dist-sort recs).
  await proCapture('redlens.tableAdvisor', '12-table-advisor.png');

  // 6i) Query & load monitoring (WLM queue / RPU cost / COPY errors).
  await proCapture('redlens.monitoring', '13-monitoring.png');

  // 6j) Sessions & locks (blocking chain).
  await vscode.commands.executeCommand('redlens.sessionsLocks');
  await sleep(2000);
  await capture('14-sessions-locks.png');

  // 6k) Datashares & Spectrum.
  await vscode.commands.executeCommand('redlens.datashares');
  await sleep(2000);
  await capture('15-datashares-spectrum.png');

  // 6l) M8b2 object privileges (demo tickit.sales — shows a role grant AND a
  //     column grant, the two things no incumbent surfaces per object).
  await vscode.commands.executeCommand('redlens.showPrivileges', {
    type: 'table',
    table: { schema: 'tickit', name: 'sales', kind: 'table' },
  });
  await sleep(2000);
  await capture('31-object-privileges.png');

  // 6m) M8b4 effective access (the moat): analyst on tickit.sales — the
  //     transitive role path (analyst_role -> etl_role) explains each grant.
  //     Pass a fully-specified {ref,user} so no picker is needed.
  await proCapture('redlens.effectivePermissions', '32-effective-access.png', {
    ref: { kind: 'table', schema: 'tickit', name: 'sales' },
    user: 'analyst',
  });

  // 7) Connection type picker (4 real connection kinds + demo).
  void vscode.commands.executeCommand('redlens.addConnection');
  await sleep(2000);
  await capture('07-tipos-conexion.png');
  await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
  await sleep(400);

  // 8) The UNLOAD shot moved out with its generator: UNLOAD/COPY became Pro in
  //     the Fase O split, and this runner loads only the base extension.

  // 9) Get Started walkthrough.
  await vscode.commands.executeCommand('workbench.action.openWalkthrough', 'lensql.redlens#redlens.getStarted');
  await sleep(2500);
  await capture('09-walkthrough.png');

  // 10) SQL editor with live linting: DELETE without WHERE (warning) + SELECT *.
  const lintDoc = await vscode.workspace.openTextDocument({
    language: 'sql',
    content: 'DELETE FROM tickit.sales;\n\nSELECT * FROM tickit.event WHERE eventid = :evento;\n',
  });
  await vscode.window.showTextDocument(lintDoc, vscode.ViewColumn.One);
  await sleep(1500);
  await vscode.commands.executeCommand('workbench.actions.view.problems');
  await sleep(1500);
  await capture('11-editor-linting.png');

  // 16) Write-safety (M4): flag the connection READ-ONLY + PRODUCTION and show
  //     the status-bar lock/alert, then attempt a write and capture the block.
  await vscode.commands.executeCommand('redlens.toggleReadOnly');
  await vscode.commands.executeCommand('redlens.toggleProduction');
  await sleep(600);
  await capture('16-write-safety-statusbar.png', { keepNotices: true });

  const writeDoc = await vscode.workspace.openTextDocument({
    language: 'sql',
    content: 'DELETE FROM tickit.sales WHERE salesid = 1;\n',
  });
  await vscode.window.showTextDocument(writeDoc, vscode.ViewColumn.One);
  await sleep(400);
  // Fire WITHOUT awaiting: read-only shows an error notification and returns.
  void vscode.commands.executeCommand('redlens.runQuery');
  await sleep(1500);
  await capture('16b-write-blocked.png', { keepNotices: true });
  // Reset flags so the shot state does not leak.
  await vscode.commands.executeCommand('redlens.toggleReadOnly');
  await vscode.commands.executeCommand('redlens.toggleProduction');
  await sleep(300);

  // 17) Inline data editing (M4): preview an editable table, turn on edit mode
  //     and show the affordances (PK locked, editable cells, Add row, Commit).
  //     Close other editors first so the grid gets the full width.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(400);
  await vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table',
    table: { schema: 'tickit', name: 'sales', kind: 'table' },
  });
  await sleep(1800);
  await vscode.commands.executeCommand('redlens.editTableData'); // toggles edit mode on the grid
  await sleep(1200);
  await capture('17-inline-edit.png');

  // 18) DML preview (M4): the exact SQL a commit generates (same text shown in
  //     the confirm dialog before anything runs). Built from a demo change-set.
  const demoChangeSet = {
    table: 'tickit.sales',
    updates: [{ pk: { salesid: 1 }, changes: { pricepaid: 99.5, qtysold: 3 } }],
    inserts: [{ salesid: 9999, eventid: 1, qtysold: 2, pricepaid: 120 }],
    deletes: [{ salesid: 2 }],
  };
  const { buildChangeSetSql } = await import('../src/edit/dmlBuilder.js');
  const dmlDoc = await vscode.workspace.openTextDocument({
    language: 'sql',
    content: '-- RedLens: pending changes — previewed before commit (also shown in the confirm dialog)\n'
      + buildChangeSetSql(demoChangeSet) + '\n',
  });
  await vscode.window.showTextDocument(dmlDoc, vscode.ViewColumn.One);
  await sleep(1200);
  await capture('18-dml-preview.png');

  // 19) Transaction control (M4): switch to manual commit — the status bar shows
  //     the manual-commit marker and the mode message.
  await vscode.commands.executeCommand('redlens.toggleAutoCommit');
  await sleep(900);
  await capture('19-transaction-control.png');
  await vscode.commands.executeCommand('redlens.toggleAutoCommit'); // back to auto
  await sleep(300);

  // 20) Paste CSV/TSV into the grid (M4): put TSV on the clipboard, open an
  //     editable table, and paste it as new rows via the command.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  await vscode.env.clipboard.writeText('9001\t1\t5\t250\n9002\t2\t3\t180\n9003\t3\t7\t99');
  await vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table',
    table: { schema: 'tickit', name: 'sales', kind: 'table' },
  });
  await sleep(1800);
  await vscode.commands.executeCommand('redlens.editTableData'); // edit mode on
  await sleep(500);
  await vscode.commands.executeCommand('redlens.pasteRowsIntoGrid'); // reads clipboard → new rows
  await sleep(1200);
  await capture('20-paste-csv-grid.png');

  // 21) PII-safe mode (M4): turn it on, preview a table with PII columns — email
  //     and phone come back masked in the grid (and in exports and the MCP).
  await vscode.workspace.getConfiguration('redlens').update('piiSafeMode', true, vscode.ConfigurationTarget.Global);
  await sleep(300);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  await vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table',
    table: { schema: 'tickit', name: 'users', kind: 'table' },
  });
  await sleep(1800);
  await capture('21-pii-safe-mode.png');
  await vscode.workspace.getConfiguration('redlens').update('piiSafeMode', false, vscode.ConfigurationTarget.Global);
  await sleep(200);

  // 22) Result charts (M5): preview a table with a text label + numeric columns
  //     (venue → venuename / venueseats) and chart it.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  await vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table',
    table: { schema: 'tickit', name: 'venue', kind: 'table' },
  });
  await sleep(1800);
  await vscode.commands.executeCommand('redlens.chartResults');
  await sleep(1400);
  await capture('22-result-charts.png');

  // 23) Grid heatmap (M5): color numeric cells by value.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  await vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table', table: { schema: 'tickit', name: 'sales', kind: 'table' },
  });
  await sleep(1800);
  await vscode.commands.executeCommand('redlens.toggleHeatmap');
  await sleep(1000);
  await capture('23-grid-heatmap.png');
  await vscode.commands.executeCommand('redlens.toggleHeatmap'); // off

  // 24) Grouping panel (M5): group users by state with count + sums.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  await vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table', table: { schema: 'tickit', name: 'users', kind: 'table' },
  });
  await sleep(1800);
  await vscode.commands.executeCommand('redlens.groupResults', 5); // column 5 = state
  await sleep(1000);
  await capture('24-grouping-panel.png');

  // 25) Transpose view (M5): swap rows and columns.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  await vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table', table: { schema: 'tickit', name: 'venue', kind: 'table' },
  });
  await sleep(1800);
  await vscode.commands.executeCommand('redlens.transposeResults');
  await sleep(1000);
  await capture('25-transpose-view.png');

  // 26) Result run compare (M5): pin last week's venue snapshot, then compare
  //     the current venue against it (keyed by venueid → added/removed/changed).
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  await vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table', table: { schema: 'tickit', name: 'venue_last_week', kind: 'table' },
  });
  await sleep(1800);
  await vscode.commands.executeCommand('redlens.pinBaseline');
  await sleep(500);
  await vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table', table: { schema: 'tickit', name: 'venue', kind: 'table' },
  });
  await sleep(1500);
  await vscode.commands.executeCommand('redlens.compareResults');
  await sleep(1200);
  await capture('26-result-run-compare.png');

  // 27) SQL notebook (M5): open a RedLens notebook and run its SQL cell against
  //     the active (demo) connection — the result renders as a markdown table.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(400);
  await vscode.commands.executeCommand('redlens.newNotebook');
  await sleep(1800);
  await vscode.commands.executeCommand('notebook.execute'); // run all cells
  await sleep(2500);
  await capture('27-sql-notebooks.png');

  // 28) Scheduled queries used to be captured here. The generator moved to the
  //     Pro extension in the Fase O split, and this runner only loads the base —
  //     so the shot belongs with the code, not with a cross-package import.

  // The schemaCompare shot moved to the Pro extension with its generator.


  // 30) Mock data generator (M7): typed INSERT rows for a table.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  const { generateMockInserts } = await import('../src/schema/mockData.js');
  const mockSql = '-- Mock data for tickit.venue (6 rows) — review before inserting\n\n'
    + generateMockInserts('tickit', 'venue',
      [{ name: 'venueid', typeName: 'int4' }, { name: 'venuename', typeName: 'varchar' }, { name: 'venuecity', typeName: 'varchar' }, { name: 'venueseats', typeName: 'int4' }],
      6, 1);
  const mockDoc = await vscode.workspace.openTextDocument({ language: 'sql', content: mockSql + '\n' });
  await vscode.window.showTextDocument(mockDoc, vscode.ViewColumn.One);
  await sleep(1000);
  await capture('30-mock-data-generator.png');

  // 31) Schema diagram / ERD (M7): boxes + FK lines as inline SVG.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  const { layoutErd, erdToSvg } = await import('../src/schema/erdLayout.js');
  const { ErdPanel } = await import('../src/schema/erdPanel.js');
  const erdTables = [
    { name: 'sales', columns: [{ name: 'salesid', typeName: 'int4' }, { name: 'eventid', typeName: 'int4' }, { name: 'qtysold', typeName: 'int2' }, { name: 'pricepaid', typeName: 'numeric' }] },
    { name: 'event', columns: [{ name: 'eventid', typeName: 'int4' }, { name: 'venueid', typeName: 'int4' }, { name: 'eventname', typeName: 'varchar' }] },
    { name: 'venue', columns: [{ name: 'venueid', typeName: 'int4' }, { name: 'venuename', typeName: 'varchar' }, { name: 'venueseats', typeName: 'int4' }] },
    { name: 'users', columns: [{ name: 'userid', typeName: 'int4' }, { name: 'username', typeName: 'varchar' }, { name: 'email', typeName: 'varchar' }] },
  ];
  const erdPanel = new ErdPanel();
  erdPanel.show(erdToSvg(layoutErd(erdTables, [{ from: 'sales', to: 'event' }, { from: 'event', to: 'venue' }], 2)), 'tickit');
  await sleep(1600);
  await capture('31-schema-designer-erd.png');

  // The dataCompare shot moved to the Pro extension with its generator.


  // 33) CSV import wizard (M7): a CSV file turned into typed INSERT statements
  //     (numeric unquoted, empty → NULL, leading-zero ZIP kept as a string).
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  const { csvToInserts } = await import('../src/schema/csvImport.js');
  const csvText = 'venueid,venuename,venuecity,zip,seats\n'
    + '1,Austin Arena,Austin,78701,10000\n'
    + '2,Denver Arena,Denver,80014,12500\n'
    + '3,Boston Hall,Boston,02108,\n'
    + "4,O'Brien Stadium,Dallas,75201,27500";
  const csvSql = '-- Import of venues.csv into staging.venue — review before running\n\n'
    + csvToInserts(csvText, 'staging', 'venue', { hasHeader: true, maxRows: 5000 });
  const csvDoc = await vscode.workspace.openTextDocument({ language: 'sql', content: csvSql + '\n' });
  await vscode.window.showTextDocument(csvDoc, vscode.ViewColumn.One);
  await sleep(1000);
  await capture('33-csv-import-wizard.png');

  // 34) Table designer (M7): a Redshift CREATE TABLE template with the
  //     DISTKEY / SORTKEY / DISTSTYLE knobs and inline guidance.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  const { createTableTemplate } = await import('../src/schema/tableDesigner.js');
  const tblDoc = await vscode.workspace.openTextDocument({ language: 'sql', content: createTableTemplate('analytics', 'orders') + '\n' });
  await vscode.window.showTextDocument(tblDoc, vscode.ViewColumn.One);
  await sleep(1000);
  await capture('34-table-designer.png');

  // 35) Visual query builder (M7): the form-based SELECT builder with a live,
  //     host-generated SQL preview. Driven with a fixed table list for a
  //     deterministic shot.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  const { QueryBuilderPanel } = await import('../src/query/queryBuilderPanel.js');
  const qb = new QueryBuilderPanel({
    loadColumns: async () => ['salesid', 'eventid', 'qtysold', 'pricepaid', 'saletime'],
    onOpen: () => { /* shot only */ },
    onRun: () => { /* shot only */ },
  });
  await qb.show([{ schema: 'tickit', table: 'sales' }, { schema: 'tickit', table: 'venue' }, { schema: 'tickit', table: 'users' }]);
  await sleep(1600);
  await capture('35-visual-query-builder.png');
  qb.dispose();

  // 36) GIS map viewer (M7): plot WKT/GeoJSON geometry as inline SVG (no basemap
  //     tiles — offline, CSP-safe). Driven with sample geometry directly.
  const { collectShapes: collectGeo } = await import('../src/geo/geoParse.js');
  const { geoToSvg: geoSvg } = await import('../src/geo/geoSvg.js');
  const { GeoMapPanel } = await import('../src/geo/geoMapPanel.js');
  const geoShapes = collectGeo([
    'POLYGON ((-122.42 37.80, -122.36 37.80, -122.36 37.74, -122.42 37.74, -122.42 37.80))',
    'LINESTRING (-122.41 37.78, -122.39 37.77, -122.37 37.79)',
    'POINT (-122.40 37.79)',
    'POINT (-122.38 37.76)',
  ]);
  const geoPanel = new GeoMapPanel();
  geoPanel.show(geoSvg(geoShapes), 'sf.zones · geom (4 shapes)');
  await sleep(1600);
  await capture('36-gis-map-viewer.png');
  geoPanel.dispose();

  // 41) The five captures the manual referenced that nothing regenerated.
  //
  //     They sat frozen at 2026-07-30 while MANUAL-DE-USO.md and four utility
  //     pages went on pointing at them, so the manual has been showing an older
  //     product than the one that ships — including a licence screen from before
  //     it could sell anything.
  //
  //     Each is a QuickPick that blocks for input, so they follow the pattern
  //     capture 04 established: fire WITHOUT awaiting, let it draw, shoot, close.
  //     That photographs the way in rather than the generated output the old
  //     images showed — which is the more useful thing for a manual anyway,
  //     because the way in is what a reader is looking for.
  for (const [command, name, needsSql] of [
    ['redlens.manageLicense', '41-licence.png', false],
    ['redlens.unloadToS3', '08-unload-sql.png', false],
    // `scheduleQuery` schedules the ACTIVE query: with no editor open,
    // `currentSql()` is undefined and the command returns without drawing
    // anything. Closing the editors between captures took its precondition away,
    // and the shot came back as an empty workbench — a capture that succeeded at
    // photographing nothing.
    ['redlens.scheduleQuery', '28-scheduled-queries.png', true],
    ['redlens.compareSchemas', '29-schema-compare.png', false],
    ['redlens.dataCompare', '32-data-compare.png', false],
  ] as const) {
    if (!(await tryCommand('workbench.action.closeAllEditors'))) break;
    await sleep(300);
    if (needsSql) {
      const sqlDoc = await vscode.workspace.openTextDocument({
        language: 'sql',
        content: 'SELECT eventname, sum(pricepaid) AS revenue\nFROM tickit.sales s JOIN tickit.event e ON e.eventid = s.eventid\nGROUP BY eventname;\n',
      });
      await vscode.window.showTextDocument(sqlDoc, vscode.ViewColumn.One);
      await sleep(700);
    }
    // Not awaited: these never resolve until somebody answers them.
    void vscode.commands.executeCommand(command);
    await sleep(2000);
    // If Pro is absent the command does not exist, the QuickPick never opens,
    // and shooting anyway would refresh the file with a picture of nothing.
    const open = await tryCommand('workbench.action.quickOpenSelectNext');
    if (!open) {
      skipped.push(`${name} (needs RedLens Pro — '${command}' is not registered)`);
      continue;
    }
    await capture(name);
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    await sleep(400);
  }

  if (skipped.length > 0) {
    console.error(`shots: ${skipped.length} capture(s) NOT taken:`);
    for (const s of skipped) {
      console.error(`  - ${s}`);
    }
  }
  console.error('SHOTS_OK');
}
