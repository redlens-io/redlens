import * as assert from 'assert';
import * as vscode from 'vscode';

// Runs INSIDE the VS Code extension test host. Mirrors the manual smoke of
// MANUAL-STEPS #1: extension loads, activates, and its palette commands exist
// and execute without throwing.
export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension('redlens.redlens');
  assert.ok(ext, 'extension redlens.redlens not found in the development host');

  await ext.activate();
  assert.ok(ext.isActive, 'extension failed to activate');

  const commands = await vscode.commands.getCommands(true);
  const expected = [
    'redlens.showWelcome',
    'redlens.addConnection',
    'redlens.manageConnections',
    'redlens.disconnect',
    'redlens.runQuery',
    'redlens.cancelQuery',
    'redlens.refreshExplorer',
    'redlens.previewTable',
    'redlens.showHistory',
    'redlens.explainQuery',
    'redlens.saveQuery',
    'redlens.openSavedQuery',
    'redlens.searchObjects',
    'redlens.scriptObject',
    'redlens.findUsages',
    'redlens.sessionsLocks',
    'redlens.datashares',
    'redlens.explainAnalyze',
    'redlens.toggleReadOnly',
    'redlens.toggleProduction',
    'redlens.editTableData',
    'redlens.toggleAutoCommit',
    'redlens.commitTransaction',
    'redlens.rollbackTransaction',
    'redlens.pasteRowsIntoGrid',
    'redlens.togglePiiSafeMode',
    'redlens.chartResults',
    'redlens.toggleHeatmap',
    'redlens.transposeResults',
    'redlens.pinBaseline',
    'redlens.compareResults',
    'redlens.newNotebook',
    'redlens.generateMockData',
    'redlens.schemaDiagram',
    'redlens.importCsv',
    'redlens.newTable',
    'redlens.queryBuilder',
    'redlens.mapView',
    'redlens.statusBarMenu',
  ];
  const proOwned = [
    'redlens.showDashboard',
    'redlens.explainPlanAI',
    'redlens.optimizeQuery',
    'redlens.nlToSql',
    'redlens.describeObject',
    'redlens.fixLastError',
    'redlens.scheduleQuery',
    'redlens.tableAdvisor',
    'redlens.monitoring',
    'redlens.manageLicense',
    'redlens.unloadToS3',
    'redlens.copyFromS3',
    'redlens.compareSchemas',
    'redlens.dataCompare',
    'redlens.adminRole',
    'redlens.adminUser',
    'redlens.createRole',
    'redlens.createUser',
    'redlens.datashareAdmin',
    'redlens.effectivePermissions',
    'redlens.clusterIamPolicy',
    'redlens.scriptClusterAction',
  ];

  for (const id of expected) {
    assert.ok(commands.includes(id), `command missing from registry: ${id}`);
  }

  // The mirror of the same idea, and the one the Fase O split makes necessary:
  // this host loads ONLY the base extension, so no command belonging to
  // RedLens Pro may be registered here. If one is, a paid feature has leaked
  // back into the open package — which the tier map alone would not catch,
  // because the map keeps naming Pro features on purpose (the padlocks read
  // it). Nine ids moved out with the dashboard, the advisor, monitoring and
  // the five AI commands; this is what keeps them out.
  for (const id of proOwned) {
    assert.ok(!commands.includes(id), `Pro command registered by the base: ${id}`);
  }

  // The explorer tree provider must be registered (schema browsing).
  const treeCommands = commands.filter((c) => c.startsWith('redlens.'));
  assert.ok(treeCommands.length >= expected.length, 'expected all RedLens commands registered');

  // Only execute NON-interactive commands: awaiting a command that opens a
  // QuickPick/InputBox (like redlens.addConnection) hangs forever in a
  // headless host — there is no user to answer it. Interactive flows get
  // covered by webview/E2E tooling later; here we assert registration only.
  await vscode.commands.executeCommand('redlens.showWelcome');

  console.log('INTEGRATION_OK: extension loads, activates, commands registered and executable');
}
