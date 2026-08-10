/**
 * The Tools catalog (M9b4): what RedLens can do, grouped the way a user thinks
 * about it rather than alphabetically. This is the data behind the "Tools" view
 * in the sidebar — the answer to "what does this thing actually do?", which the
 * Command Palette cannot give because it is flat by design.
 *
 * Invariant (enforced by tests/toolsCatalog.test.ts): this catalog lists exactly
 * the palette-visible commands. Object-scoped commands are deliberately absent —
 * they live on the object, in the tree context menu.
 */

export interface ToolEntry {
  /** Command id, must exist in package.json contributes.commands. */
  command: string;
  /** Short label shown in the tree (mirrors the command title). */
  label: string;
  /** One line explaining what it does — the tooltip, and the real payload. */
  detail: string;
  /** Codicon id. */
  icon: string;
  /** True when it cannot do anything without an active connection. */
  needsConnection?: boolean;
}

export interface ToolGroup {
  id: string;
  label: string;
  icon: string;
  /** Open on first render — reserved for the group used every day. */
  defaultExpanded?: boolean;
  tools: ToolEntry[];
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'query',
    label: 'Query',
    icon: 'play',
    defaultExpanded: true,
    tools: [
      { command: 'redlens.runQuery', label: 'Run Query', detail: 'Run the current statement or selection (Ctrl+Enter).', icon: 'play', needsConnection: true },
      { command: 'redlens.cancelQuery', label: 'Cancel Query', detail: 'Stop the statement that is currently running.', icon: 'stop-circle', needsConnection: true },
      { command: 'redlens.queryBuilder', label: 'Visual Query Builder', detail: 'Build a SELECT by picking columns, filters and a limit.', icon: 'list-tree', needsConnection: true },
      { command: 'redlens.newNotebook', label: 'New SQL Notebook', detail: 'A notebook of SQL cells with their own result grids.', icon: 'notebook' },
      { command: 'redlens.showHistory', label: 'Query History', detail: 'Everything you have run, with timing — rerun from here.', icon: 'history' },
      { command: 'redlens.saveQuery', label: 'Save Query', detail: 'Bookmark the current SQL under a name.', icon: 'bookmark' },
      { command: 'redlens.openSavedQuery', label: 'Open Saved Query', detail: 'Reopen a bookmarked query, filling any parameters.', icon: 'go-to-file' },
      { command: 'redlens.explainQuery', label: 'Explain Query', detail: 'Visualize the plan and flag broadcasts and skew.', icon: 'type-hierarchy', needsConnection: true },
      { command: 'redlens.explainAnalyze', label: 'Explain Analyze', detail: 'Run it and show a flamegraph of the actual timing.', icon: 'flame', needsConnection: true },
      { command: 'redlens.scheduleQuery', label: 'Schedule Query', detail: 'Generate the AWS CLI to run this on a schedule.', icon: 'watch' },
    ],
  },
  {
    id: 'schema',
    label: 'Schema & Data',
    icon: 'symbol-namespace',
    tools: [
      { command: 'redlens.searchObjects', label: 'Go to Table or Column', detail: 'Jump to any object by name across all schemas.', icon: 'search', needsConnection: true },
      { command: 'redlens.findUsages', label: 'Find Usages', detail: 'Where a table or column is referenced in your .sql files.', icon: 'references' },
      { command: 'redlens.refreshExplorer', label: 'Refresh Explorer', detail: 'Re-read the catalog after a schema change.', icon: 'refresh', needsConnection: true },
      { command: 'redlens.newTable', label: 'New Table', detail: 'CREATE TABLE with Redshift distkey/sortkey guidance.', icon: 'new-file' },
      { command: 'redlens.schemaDiagram', label: 'Schema Diagram', detail: 'ERD of a schema, from its declared foreign keys.', icon: 'graph' },
      { command: 'redlens.compareSchemas', label: 'Compare Schemas', detail: 'Diff two schemas and generate the migration DDL.', icon: 'diff', needsConnection: true },
      { command: 'redlens.dataCompare', label: 'Compare Table Data', detail: 'Row-level diff between two tables.', icon: 'diff-multiple', needsConnection: true },
      { command: 'redlens.mapView', label: 'Map View', detail: 'Plot a WKT/GeoJSON column on an offline map.', icon: 'globe', needsConnection: true },
    ],
  },
  {
    id: 'performance',
    label: 'Performance',
    icon: 'dashboard',
    tools: [
      { command: 'redlens.showDashboard', label: 'Performance Dashboard', detail: 'Cluster health from the SYS_* views at a glance.', icon: 'dashboard', needsConnection: true },
      { command: 'redlens.tableAdvisor', label: 'Table Advisor', detail: 'Distkey/sortkey advice, skew and stale statistics.', icon: 'lightbulb', needsConnection: true },
      { command: 'redlens.monitoring', label: 'Query & Load Monitoring', detail: 'WLM queueing, RPU cost and decoded COPY errors.', icon: 'pulse', needsConnection: true },
      { command: 'redlens.sessionsLocks', label: 'Sessions & Locks', detail: 'Who is connected and what is blocking what.', icon: 'lock', needsConnection: true },
    ],
  },
  {
    id: 'cluster',
    label: 'Cluster',
    icon: 'server',
    tools: [
      { command: 'redlens.showCluster', label: 'Cluster Configuration', detail: 'The console properties of this warehouse, read-only.', icon: 'server', needsConnection: true },
      { command: 'redlens.refreshCluster', label: 'Refresh Cluster', detail: 'Re-read the control plane after changing something.', icon: 'refresh', needsConnection: true },
      { command: 'redlens.clusterIamPolicy', label: 'Script IAM Policy', detail: 'The read-only AWS policy RedLens needs, explained.', icon: 'key', needsConnection: true },
      { command: 'redlens.scriptClusterAction', label: 'Script Cluster Action', detail: 'Generate the aws CLI to pause, resize or reconfigure.', icon: 'terminal', needsConnection: true },
    ],
  },
  {
    id: 'governance',
    label: 'Governance & Sharing',
    icon: 'shield',
    tools: [
      { command: 'redlens.datashares', label: 'Datashares & Spectrum', detail: 'Inbound and outbound shares plus external tables.', icon: 'link', needsConnection: true },
      { command: 'redlens.datashareAdmin', label: 'Script Datashare', detail: 'Guided producer/consumer datashare SQL, for review.', icon: 'file-code', needsConnection: true },
      { command: 'redlens.createUser', label: 'Script Create User', detail: 'Generate CREATE USER for review — never executed.', icon: 'person-add', needsConnection: true },
      { command: 'redlens.createRole', label: 'Script Create Role', detail: 'Generate CREATE ROLE for review — never executed.', icon: 'shield', needsConnection: true },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    icon: 'sparkle',
    tools: [
      { command: 'redlens.nlToSql', label: 'Generate SQL with AI', detail: 'Describe what you want; get SQL grounded in your schema.', icon: 'sparkle' },
      { command: 'redlens.explainPlanAI', label: 'Explain Plan with AI', detail: 'Plain-language reading of the current execution plan.', icon: 'sparkle' },
      { command: 'redlens.optimizeQuery', label: 'Optimize Query with AI', detail: 'Rewrite suggestions for the query in the editor.', icon: 'sparkle' },
      { command: 'redlens.fixLastError', label: 'Fix Last Error with AI', detail: 'Turn the last failure into a concrete fix.', icon: 'sparkle' },
    ],
  },
  {
    id: 'transfer',
    label: 'Import & Export',
    icon: 'cloud',
    tools: [
      { command: 'redlens.importCsv', label: 'Import CSV', detail: 'Turn a CSV/TSV file into reviewable INSERT statements.', icon: 'desktop-download' },
      { command: 'redlens.unloadToS3', label: 'UNLOAD to S3', detail: 'Build the UNLOAD for the current query.', icon: 'cloud-upload', needsConnection: true },
      { command: 'redlens.copyFromS3', label: 'COPY from S3', detail: 'Build the COPY to load a table from S3.', icon: 'cloud-download', needsConnection: true },
    ],
  },
  {
    id: 'connection',
    label: 'Connection & Session',
    icon: 'plug',
    tools: [
      { command: 'redlens.manageConnections', label: 'Manage Connections', detail: 'Switch, edit or remove a saved connection.', icon: 'plug' },
      { command: 'redlens.addConnection', label: 'Add Connection', detail: 'Add a Redshift, Data API, SSH or demo connection.', icon: 'add' },
      { command: 'redlens.manageHostKeys', label: 'Manage SSH Host Keys', detail: 'Review or forget remembered SSH bastion fingerprints.', icon: 'key' },
      { command: 'redlens.disconnect', label: 'Disconnect', detail: 'Close the active connection.', icon: 'debug-disconnect', needsConnection: true },
      { command: 'redlens.statusBarMenu', label: 'Status & Toggles', detail: 'Read-only, production, auto-commit and PII-safe switches.', icon: 'settings-gear' },
      { command: 'redlens.toggleReadOnly', label: 'Toggle Read-Only', detail: 'Block every write on this connection.', icon: 'lock', needsConnection: true },
      { command: 'redlens.toggleProduction', label: 'Toggle Production Safeguard', detail: 'Require confirmation before any write.', icon: 'warning', needsConnection: true },
      { command: 'redlens.toggleAutoCommit', label: 'Toggle Auto-Commit', detail: 'Switch to manual transactions.', icon: 'git-commit', needsConnection: true },
      { command: 'redlens.togglePiiSafeMode', label: 'Toggle PII-Safe Mode', detail: 'Mask sensitive columns everywhere, including for AI agents.', icon: 'eye-closed' },
      { command: 'redlens.commitTransaction', label: 'Commit Transaction', detail: 'Commit the open transaction.', icon: 'check', needsConnection: true },
      { command: 'redlens.rollbackTransaction', label: 'Rollback Transaction', detail: 'Discard the open transaction.', icon: 'discard', needsConnection: true },
      { command: 'redlens.manageLicense', label: 'Manage Licence', detail: 'Your tier, the trial, and where to paste a licence key.', icon: 'key' },
      { command: 'redlens.showWelcome', label: 'Welcome', detail: 'What RedLens is and how to get started.', icon: 'info' },
    ],
  },
];

/** Flat view of the catalog, for lookups and tests. */
export function allTools(): ToolEntry[] {
  return TOOL_GROUPS.flatMap((g) => g.tools);
}
