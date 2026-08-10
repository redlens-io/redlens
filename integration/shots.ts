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

function capture(name: string): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  execSync(`import -window root ${path.join(OUT_DIR, name)}`, { env: process.env });
  console.error(`captured ${name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension('redlens.redlens');
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

  // 1) Explorer with the demo warehouse.
  await vscode.commands.executeCommand('workbench.view.extension.redlens');
  await sleep(2500);
  capture('01-explorador-demo.png');

  // 1a-bis) M9b4 Tools view: the catalog grouped by intent, Query pre-expanded.
  await vscode.commands.executeCommand('redlensTools.focus');
  await sleep(1500);
  capture('33-tools-view.png');

  // 1b) M8b1 governance tree: Schemas / Datashares / Users & Roles sections.
  //     Best-effort expand so the datashare + user/role nodes are visible; the
  //     section headers are captured regardless (list.expandAll is only present
  //     when a list is focused, and may be absent in the headless workbench).
  await vscode.commands.executeCommand('redlensExplorer.focus');
  await sleep(400);
  try {
    await vscode.commands.executeCommand('list.expandAll');
  } catch {
    /* headless workbench without the list command — sections still show */
  }
  await sleep(1500);
  capture('30-gobernanza-arbol.png');

  // 2) Table preview → interactive grid. tickit.sales has an FK on eventid,
  //    so the grid shows the 🔗 marker (fk-navigation).
  await vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table',
    table: { schema: 'tickit', name: 'sales', kind: 'table' },
  });
  await sleep(2500);
  capture('02-preview-resultados.png');
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
  capture('03-editor-sql.png');

  // 4) Connections QuickPick (fire WITHOUT awaiting — it blocks for input).
  void vscode.commands.executeCommand('redlens.manageConnections');
  await sleep(1800);
  capture('04-conexiones.png');
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
  capture('05-explain-plan.png');

  // 6) Performance dashboard (demo SYS_* fixtures + demo CloudWatch cards).
  await vscode.commands.executeCommand('redlens.showDashboard');
  await sleep(2500);
  capture('06-dashboard.png');

  // 6a) Same panel maximized: the CloudWatch infrastructure row only reads as a
  //     row when the editor is wide, and that row is the point of M10b1.
  await vscode.commands.executeCommand('workbench.action.closeEditorsInOtherGroups');
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await sleep(1800);
  capture('37-cloudwatch-metrics.png');
  await vscode.commands.executeCommand('workbench.action.focusSideBar');
  await sleep(600);

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
  capture('38-cluster-properties.png');

  await vscode.commands.executeCommand('redlens.cluster.showSection', 'parameters');
  await sleep(2000);
  capture('39-cluster-parameters.png');

  // 6c) Backups (M10b3): snapshots next to the 30-minute recovery points, which
  //     is the pairing people get wrong about Serverless.
  await vscode.commands.executeCommand('redlens.cluster.showSection', 'snapshots');
  await sleep(2000);
  capture('40-cluster-snapshots.png');

  // 6d) The licence screen used to be captured here (41-licence.png). It moved
  //     out with the Fase O split: `redlens.manageLicense` belongs to the Pro
  //     extension now, and this runner only ever loads the base. Capturing it
  //     from here would mean either shipping licensing back into the open
  //     package or photographing a command that is not registered.

  // 6h) Table optimization advisor (skew / vacuum-analyze / dist-sort recs).
  await vscode.commands.executeCommand('redlens.tableAdvisor');
  await sleep(2500);
  capture('12-table-advisor.png');

  // 6i) Query & load monitoring (WLM queue / RPU cost / COPY errors).
  await vscode.commands.executeCommand('redlens.monitoring');
  await sleep(2500);
  capture('13-monitoring.png');

  // 6j) Sessions & locks (blocking chain).
  await vscode.commands.executeCommand('redlens.sessionsLocks');
  await sleep(2000);
  capture('14-sessions-locks.png');

  // 6k) Datashares & Spectrum.
  await vscode.commands.executeCommand('redlens.datashares');
  await sleep(2000);
  capture('15-datashares-spectrum.png');

  // 6l) M8b2 object privileges (demo tickit.sales — shows a role grant AND a
  //     column grant, the two things no incumbent surfaces per object).
  await vscode.commands.executeCommand('redlens.showPrivileges', {
    type: 'table',
    table: { schema: 'tickit', name: 'sales', kind: 'table' },
  });
  await sleep(2000);
  capture('31-object-privileges.png');

  // 6m) M8b4 effective access (the moat): analyst on tickit.sales — the
  //     transitive role path (analyst_role -> etl_role) explains each grant.
  //     Pass a fully-specified {ref,user} so no picker is needed.
  await vscode.commands.executeCommand('redlens.effectivePermissions', {
    ref: { kind: 'table', schema: 'tickit', name: 'sales' },
    user: 'analyst',
  });
  await sleep(2000);
  capture('32-effective-access.png');

  // 7) Connection type picker (4 real connection kinds + demo).
  void vscode.commands.executeCommand('redlens.addConnection');
  await sleep(2000);
  capture('07-tipos-conexion.png');
  await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
  await sleep(400);

  // 8) The UNLOAD shot moved out with its generator: UNLOAD/COPY became Pro in
  //     the Fase O split, and this runner loads only the base extension.

  // 9) Get Started walkthrough.
  await vscode.commands.executeCommand('workbench.action.openWalkthrough', 'redlens.redlens#redlens.getStarted');
  await sleep(2500);
  capture('09-walkthrough.png');

  // 10) SQL editor with live linting: DELETE without WHERE (warning) + SELECT *.
  const lintDoc = await vscode.workspace.openTextDocument({
    language: 'sql',
    content: 'DELETE FROM tickit.sales;\n\nSELECT * FROM tickit.event WHERE eventid = :evento;\n',
  });
  await vscode.window.showTextDocument(lintDoc, vscode.ViewColumn.One);
  await sleep(1500);
  await vscode.commands.executeCommand('workbench.actions.view.problems');
  await sleep(1500);
  capture('11-editor-linting.png');

  // 16) Write-safety (M4): flag the connection READ-ONLY + PRODUCTION and show
  //     the status-bar lock/alert, then attempt a write and capture the block.
  await vscode.commands.executeCommand('redlens.toggleReadOnly');
  await vscode.commands.executeCommand('redlens.toggleProduction');
  await sleep(600);
  capture('16-write-safety-statusbar.png');

  const writeDoc = await vscode.workspace.openTextDocument({
    language: 'sql',
    content: 'DELETE FROM tickit.sales WHERE salesid = 1;\n',
  });
  await vscode.window.showTextDocument(writeDoc, vscode.ViewColumn.One);
  await sleep(400);
  // Fire WITHOUT awaiting: read-only shows an error notification and returns.
  void vscode.commands.executeCommand('redlens.runQuery');
  await sleep(1500);
  capture('16b-write-blocked.png');
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
  capture('17-inline-edit.png');

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
  capture('18-dml-preview.png');

  // 19) Transaction control (M4): switch to manual commit — the status bar shows
  //     the manual-commit marker and the mode message.
  await vscode.commands.executeCommand('redlens.toggleAutoCommit');
  await sleep(900);
  capture('19-transaction-control.png');
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
  capture('20-paste-csv-grid.png');

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
  capture('21-pii-safe-mode.png');
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
  capture('22-result-charts.png');

  // 23) Grid heatmap (M5): color numeric cells by value.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  await vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table', table: { schema: 'tickit', name: 'sales', kind: 'table' },
  });
  await sleep(1800);
  await vscode.commands.executeCommand('redlens.toggleHeatmap');
  await sleep(1000);
  capture('23-grid-heatmap.png');
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
  capture('24-grouping-panel.png');

  // 25) Transpose view (M5): swap rows and columns.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  await vscode.commands.executeCommand('redlens.previewTable', {
    type: 'table', table: { schema: 'tickit', name: 'venue', kind: 'table' },
  });
  await sleep(1800);
  await vscode.commands.executeCommand('redlens.transposeResults');
  await sleep(1000);
  capture('25-transpose-view.png');

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
  capture('26-result-run-compare.png');

  // 27) SQL notebook (M5): open a RedLens notebook and run its SQL cell against
  //     the active (demo) connection — the result renders as a markdown table.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(400);
  await vscode.commands.executeCommand('redlens.newNotebook');
  await sleep(1800);
  await vscode.commands.executeCommand('notebook.execute'); // run all cells
  await sleep(2500);
  capture('27-sql-notebooks.png');

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
  capture('30-mock-data-generator.png');

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
  capture('31-schema-designer-erd.png');

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
  capture('33-csv-import-wizard.png');

  // 34) Table designer (M7): a Redshift CREATE TABLE template with the
  //     DISTKEY / SORTKEY / DISTSTYLE knobs and inline guidance.
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(300);
  const { createTableTemplate } = await import('../src/schema/tableDesigner.js');
  const tblDoc = await vscode.workspace.openTextDocument({ language: 'sql', content: createTableTemplate('analytics', 'orders') + '\n' });
  await vscode.window.showTextDocument(tblDoc, vscode.ViewColumn.One);
  await sleep(1000);
  capture('34-table-designer.png');

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
  capture('35-visual-query-builder.png');
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
  capture('36-gis-map-viewer.png');
  geoPanel.dispose();

  console.error('SHOTS_OK');
}
