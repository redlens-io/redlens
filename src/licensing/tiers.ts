/**
 * Who gets what (M10b5) — pure, and the ONLY place that decides. The padlocks
 * in the Tools view, the command gate and the docs all read this map; a feature
 * cannot be Pro in one surface and Free in another.
 *
 * The principle Diego approved: **Free is for working with data, Pro is for
 * saving money, avoiding incidents and governing.** So the daily loop — connect,
 * browse, edit, run, read results, export — is free forever and complete, and
 * what you pay for is the warehouse-specific advice, the console, the AI, the
 * governance admin and the S3 pipelines.
 *
 * Two rules that are not negotiable and are enforced by tests:
 *  - Every safety feature is Free. Charging for not leaking PII is a position
 *    nobody wants to defend to an enterprise buyer.
 *  - Connections are never counted. Database Client caps them at 3 and it is
 *    the single loudest complaint in its reviews.
 */

export type Tier = 'free' | 'pro';

/**
 * Feature ids are command ids wherever a command exists, so the gate can look up
 * exactly what the user invoked. The handful that are not commands (Cluster view
 * sections, MCP tool groups) use a `redlens.<area>.<name>` id of their own.
 */
export const FEATURE_TIERS: Record<string, Tier> = {
  // --- Query: the daily loop is free, scheduling is ops -------------------
  'redlens.runQuery': 'free',
  'redlens.cancelQuery': 'free',
  'redlens.queryBuilder': 'free',
  'redlens.newNotebook': 'free',
  'redlens.showHistory': 'free',
  'redlens.saveQuery': 'free',
  'redlens.openSavedQuery': 'free',
  'redlens.explainQuery': 'free',
  'redlens.explainAnalyze': 'free',
  'redlens.scheduleQuery': 'pro',

  // --- Schema & data: browsing free, migration tooling Pro ----------------
  'redlens.searchObjects': 'free',
  'redlens.findUsages': 'free',
  'redlens.refreshExplorer': 'free',
  'redlens.newTable': 'free',
  'redlens.schemaDiagram': 'free',
  'redlens.mapView': 'free',
  'redlens.previewTable': 'free',
  'redlens.scriptObject': 'free',
  'redlens.generateMockData': 'free',
  'redlens.compareSchemas': 'pro',
  'redlens.dataCompare': 'pro',

  // --- The grid: all of it, forever. This is where DBeaver is fought ------
  'redlens.chartResults': 'free',
  'redlens.toggleHeatmap': 'free',
  'redlens.transposeResults': 'free',
  'redlens.groupResults': 'free',
  'redlens.pinBaseline': 'free',
  'redlens.compareResults': 'free',
  'redlens.editTableData': 'free',
  'redlens.pasteRowsIntoGrid': 'free',
  'redlens.commitGridEdits': 'free',

  // --- Performance: the moat ---------------------------------------------
  'redlens.sessionsLocks': 'free',
  'redlens.showDashboard': 'pro',
  'redlens.tableAdvisor': 'pro',
  'redlens.monitoring': 'pro',

  // --- Cluster / console --------------------------------------------------
  'redlens.showCluster': 'free',            // Properties — the visibility hook
  'redlens.cluster.showSection': 'free',    // gated per section, below
  'redlens.refreshCluster': 'free',
  'redlens.clusterIamPolicy': 'pro',
  'redlens.scriptClusterAction': 'pro',
  'redlens.cluster.section.properties': 'free',
  'redlens.cluster.section.parameters': 'pro',
  'redlens.cluster.section.network': 'pro',
  'redlens.cluster.section.snapshots': 'pro',
  'redlens.cluster.section.maintenance': 'pro',
  'redlens.cluster.section.logging': 'pro',
  'redlens.cluster.section.scheduled': 'pro',
  'redlens.cluster.section.limits': 'pro',
  'redlens.cluster.section.events': 'pro',
  'redlens.cluster.section.reserved': 'pro',

  // --- Governance: the tree and the viewers beat DBeaver CE for free ------
  'redlens.datashares': 'free',
  'redlens.showPrivileges': 'free',
  'redlens.scriptGrants': 'free',
  'redlens.datashare.copyNamespace': 'free',
  'redlens.datashare.queryObject': 'free',
  // Not a command: the "Security policies" section of the Database tree. It
  // still needs an id, because PLAN-M8 §8 made RLS/masking Pro and a tier with
  // no gate is a decision that only exists on paper.
  'redlens.governance.securityPolicies': 'pro',
  'redlens.createUser': 'pro',
  'redlens.createRole': 'pro',
  'redlens.adminUser': 'pro',
  'redlens.adminRole': 'pro',
  'redlens.datashareAdmin': 'pro',
  'redlens.effectivePermissions': 'pro',

  // --- AI: all of it (Diego, 2026-07-26 — ratifying PLAN.md §4) -----------
  'redlens.nlToSql': 'pro',
  'redlens.explainPlanAI': 'pro',
  'redlens.optimizeQuery': 'pro',
  'redlens.fixLastError': 'pro',
  'redlens.describeObject': 'pro',
  // Not a command: the @redlens chat participant, Pro since PLAN.md §4. Checked
  // when a request arrives, because the command gate never sees it.
  'redlens.chat.participant': 'pro',

  // --- Import / export ----------------------------------------------------
  'redlens.importCsv': 'free',
  'redlens.unloadToS3': 'pro',
  'redlens.copyFromS3': 'pro',

  // --- Connections and session: never capped, never counted ---------------
  'redlens.addConnection': 'free',
  'redlens.manageConnections': 'free',
  'redlens.connectToProfile': 'free',
  'redlens.disconnect': 'free',
  'redlens.manageHostKeys': 'free',
  'redlens.statusBarMenu': 'free',
  'redlens.commitTransaction': 'free',
  'redlens.rollbackTransaction': 'free',
  'redlens.showWelcome': 'free',
  // Implemented by the Pro extension: without it installed there is no licence
  // to manage, so the padlock leads to the install offer rather than to a
  // command that is not there. The *way out* of the paywall stays Free — that
  // is `redlens.proUpsell`, below.
  'redlens.manageLicense': 'pro',
  // The offer behind a padlock. Free by necessity as much as by choice: it is
  // what a locked-out user clicks, so gating it would lock the way out too.
  'redlens.proUpsell': 'free',

  // --- Safety: free, always ----------------------------------------------
  'redlens.toggleReadOnly': 'free',
  'redlens.toggleProduction': 'free',
  'redlens.toggleAutoCommit': 'free',
  'redlens.togglePiiSafeMode': 'free',

  // --- MCP: read-only basics free, the moat tools Pro (PLAN.md §5.4) ------
  // NOTE: the five Pro tools below are not implemented yet — the embedded
  // server ships only the read-only set. These entries record the decision so
  // the tools cannot be built ungated later; they gate nothing today.
  'redlens.mcp.list': 'free',
  'redlens.mcp.executeQuery': 'free',
  'redlens.mcp.explainQuery': 'free',
  'redlens.mcp.tableHealth': 'pro',
  'redlens.mcp.queryHistory': 'pro',
  'redlens.mcp.recommendations': 'pro',
  'redlens.mcp.executeWrite': 'pro',
  'redlens.mcp.unloadToS3': 'pro',
};

/** Features whose tier can never change, whatever a future price experiment says. */
export const ALWAYS_FREE: readonly string[] = [
  'redlens.toggleReadOnly',
  'redlens.toggleProduction',
  'redlens.toggleAutoCommit',
  'redlens.togglePiiSafeMode',
  'redlens.addConnection',
  'redlens.manageConnections',
  'redlens.connectToProfile',
  'redlens.disconnect',
];

/** Unknown ids are Free: a feature nobody classified must never lock a user out. */
export function tierOf(featureId: string): Tier {
  return FEATURE_TIERS[featureId] ?? 'free';
}

export function requiresPro(featureId: string): boolean {
  return tierOf(featureId) === 'pro';
}

export function clusterSectionFeature(sectionId: string): string {
  return `redlens.cluster.section.${sectionId}`;
}

/** What the paywall says about a specific feature — vague copy converts nobody. */
export const PRO_PITCH: Record<string, string> = {
  'redlens.showDashboard': 'CloudWatch infrastructure metrics and the RPU cost of the window you are looking at.',
  'redlens.tableAdvisor': 'Distkey/sortkey advice, skew, stale statistics, and the AWS Advisor with the SQL it recommends.',
  'redlens.monitoring': 'WLM queueing, RPU cost per query and decoded COPY errors.',
  'redlens.compareSchemas': 'Diff two schemas and get the migration DDL.',
  'redlens.dataCompare': 'Row-level diff between two tables.',
  'redlens.scheduleQuery': 'Generate the EventBridge Scheduler CLI to run a query on a schedule.',
  'redlens.effectivePermissions': 'Why a user can do something: transitive role resolution with the path that grants it.',
  'redlens.unloadToS3': 'Guided UNLOAD to S3, with the format, compression and partitioning options filled in.',
  'redlens.copyFromS3': 'Guided COPY from S3, including the IAM role and the error handling that COPY needs.',
  'redlens.clusterIamPolicy': 'The read-only IAM policy RedLens needs, with what breaks without each statement.',
  'redlens.scriptClusterAction': 'The aws CLI to pause, resize or reconfigure — generated for you to review and run.',
};

const AI_PITCH = 'AI grounded in your live schema, running on your own Copilot subscription.';
const ADMIN_PITCH = 'Generated user, role and datashare SQL for review — never executed.';
const CONSOLE_PITCH = 'The Redshift console configuration in the sidebar: parameters, backups, logging, limits and events.';

export function pitchFor(featureId: string): string {
  if (PRO_PITCH[featureId] !== undefined) {
    return PRO_PITCH[featureId] ?? '';
  }
  if (featureId.startsWith('redlens.cluster.section.')) {
    return CONSOLE_PITCH;
  }
  if (['redlens.nlToSql', 'redlens.explainPlanAI', 'redlens.optimizeQuery', 'redlens.fixLastError', 'redlens.describeObject'].includes(featureId)) {
    return AI_PITCH;
  }
  return ADMIN_PITCH;
}
