/**
 * The RedLens bridge API — the contract between the open base extension and
 * RedLens Pro (Fase O, decision E1: the Pylance / C# Dev Kit pattern).
 *
 * This file is TYPES ONLY, deliberately: it is vendored verbatim into the Pro
 * repo as `redlens-api.d.ts`, and a test in each repo fails if the two copies
 * drift. A hand-copied contract is only safe when something checks the copy,
 * and that check is what lets the two repos stay genuinely decoupled — which
 * is the whole point of the split.
 *
 * Direction of dependency, without exception: **Pro imports the base, never the
 * reverse.** The base must compile, test and package with no knowledge that Pro
 * exists. That is what makes the public repo self-contained.
 *
 * How Pro gets hold of this:
 *
 * ```ts
 * const base = vscode.extensions.getExtension<RedLensExports>('lensql.redlens');
 * // extensionDependencies guarantees the base is already active — no polling,
 * // no race. If it is missing, the user disabled it; say so and stand down.
 * const api = base?.exports.getApi(1);
 * ```
 */

import type * as vscode from 'vscode';

/** What the base returns from `activate()`. Versioned, never widened in place. */
export interface RedLensExports {
  /**
   * Returns the API at `version`, or `undefined` if this build no longer
   * offers it. Modelled on `vscode.typescript-language-features`'s `getAPI(n)`.
   *
   * Asking for a version instead of reading a bare object is what turns "new
   * base + old Pro" from a TypeError deep inside a panel into one clear message
   * at activation.
   */
  getApi(version: 1): RedLensApi | undefined;
}

export interface RedLensApi {
  readonly apiVersion: 1;
  /** The base extension's own version, for diagnostics and compatibility notes. */
  readonly baseVersion: string;
  readonly connections: ConnectionsApi;
  readonly metadata: MetadataApi;
  readonly governance: GovernanceApi;
  readonly cluster: ClusterApi;
  readonly analysis: AnalysisApi;
  readonly ui: UiApi;
  readonly licensing: LicensingApi;
}

// --- Data plane -------------------------------------------------------------

export interface ColumnInfo {
  name: string;
  /** Redshift type name as reported by the engine (e.g. int8, varchar, super). */
  typeName: string;
  nullable: boolean;
}

export interface QueryRows {
  columns: ColumnInfo[];
  rows: unknown[][];
}

/** The connection Pro is looking at, reduced to what a Pro feature may know. */
export interface ActiveConnectionInfo {
  readonly profileId: string;
  readonly profileName: string;
  /** The database this connection is pointed at — Pro's codegen names it. */
  readonly database: string;
  /**
   * Mirrors `ProfileKind`, including `compat` — plain PostgreSQL, which the
   * project's own test harness runs against. A Pro feature that assumes every
   * connection is Redshift breaks there first, so the kind is exposed rather
   * than smoothed over.
   */
  readonly kind: 'direct' | 'compat' | 'demo' | 'data-api' | 'direct+ssh';
  /** Session write-safety flags. Pro must respect these, it does not set them. */
  readonly readOnly: boolean;
  readonly production: boolean;
  readonly autoCommit: boolean;
  readonly inTransaction: boolean;
  /** Region + cluster/workgroup/namespace, when the profile resolves to AWS. */
  readonly aws?: AwsTarget;
}

export interface AwsTarget {
  readonly region: string;
  readonly clusterIdentifier?: string;
  readonly workgroupName?: string;
  readonly namespaceName?: string;
}

export interface ConnectionsApi {
  getActive(): ActiveConnectionInfo | undefined;
  readonly onDidChangeActive: vscode.Event<void>;
  /**
   * Runs a statement and drains its result set.
   *
   * Goes through the same guards as the base's own queries — read-only toggle,
   * production safeguard, transaction state. A Pro feature cannot reach past
   * them, which is deliberate: every safety feature is Free and stays
   * authoritative over paid code.
   *
   * Rejects when there is no active connection.
   */
  query(sql: string, options?: { signal?: AbortSignal }): Promise<QueryRows>;
  /**
   * The EXPLAIN plan for a statement, rendered as text.
   *
   * Reading a plan is a Free capability — the base owns the parser and the
   * visualizer. Pro asks for it here rather than re-parsing, so the AI
   * explanation is grounded in exactly what the user sees in the plan panel,
   * and the contract stays free of the plan-node types.
   */
  explainText(sql: string, analyze?: boolean): Promise<{ planText: string; warnings: string[] }>;
  /** Last failed statement on this connection — for Fix Last Error with AI. */
  getLastFailure(): { sql: string; error: string } | undefined;
}

// --- Catalog ----------------------------------------------------------------

export interface TableInfo {
  schema: string;
  name: string;
  kind: 'table' | 'view' | 'external';
}

export interface ColumnMeta {
  name: string;
  typeName: string;
  nullable: boolean;
}

export interface MetadataApi {
  readonly onDidChange: vscode.Event<void>;
  hasSource(): boolean;
  listSchemas(): Promise<string[]>;
  listTables(schema: string): Promise<TableInfo[]>;
  listColumns(schema: string, table: string): Promise<ColumnMeta[]>;
  listPrimaryKey(schema: string, table: string): Promise<string[]>;
  /** Synchronous cache view — for grounding a prompt without awaiting mid-flow. */
  cachedSchemas(): string[];
  cachedTables(schema: string): TableInfo[];
  cachedColumns(schema: string, table: string): ColumnMeta[];
}

export interface GovernanceApi {
  /** False on plain Postgres and without a connection — no SVV_/PG_USER views. */
  supported(): boolean;
  listUsers(): Promise<GovernanceIdentity[]>;
  listRoles(): Promise<GovernanceIdentity[]>;
  /**
   * Why a user can do something on an object: the transitive role closure with
   * the path that grants each privilege (M8b4, the moat).
   *
   * The resolver stays in the base because the FREE governance service uses it
   * too; what is Pro is the panel that explains the answer. Exposing the result
   * rather than the resolver keeps one implementation of the role algebra.
   */
  effectivePermissions(ref: ObjectRef, userName: string): Promise<EffectiveResult>;
  /** Invalidate the base's cache after Pro generated DDL the user then ran. */
  invalidate(): void;
}

export interface GovernanceIdentity {
  name: string;
  kind: 'user' | 'role';
  /**
   * Managed by an external IdP (IAM:/IAMR:/AWSIDC:/<idp>: prefix). Pro's codegen
   * refuses these: the DDL would succeed and then be undone by the next
   * federation sync, which is worse than not offering it.
   */
  federated?: boolean;
  /** Internal AWS user (rdsdb) — never a legitimate admin target. */
  system?: boolean;
  superuser?: boolean;
  createDb?: boolean;
}

/** A database object a privilege question is asked about. */
export interface ObjectRef {
  kind: 'table' | 'schema';
  schema: string;
  /** Table/view name; omitted for a schema ref. */
  name?: string;
}

export interface EffectivePrivilege {
  privilege: string;
  /** Optional column for column-level grants. */
  column?: string;
  reasons: string[];
}

export interface EffectivePermissions {
  user: string;
  object: string;
  /** All-access short-circuit (superuser or owner); privileges omitted then. */
  allAccess?: { reason: string };
  /** Transitive role closure the user effectively holds (empty for allAccess). */
  effectiveRoles: string[];
  privileges: EffectivePrivilege[];
}

export interface EffectiveResult {
  perms: EffectivePermissions;
  /** True when role membership could not be read (superuser-gated) → partial. */
  partial: boolean;
}

/** One label/value line of a Cluster-view section. */
export interface InfoRow {
  label: string;
  value: string;
  /** Differs from the engine default — the reason this view exists. */
  nonDefault?: boolean;
  /** Something the reader should look at twice (public, unencrypted, pending). */
  warn?: boolean;
  /** Extra context rendered under the value. */
  note?: string;
}

export interface InfoGroup {
  title: string;
  rows: InfoRow[];
}

/**
 * What a Cluster-view section renders.
 *
 * On the contract because it is the shape Pro hands back through
 * `ui.contributeClusterSections` — the render contract between the two halves
 * of one view. The SDK-shaped types that produce it are not here: those belong
 * to whichever package makes the AWS call.
 */
export interface SectionModel {
  id: string;
  title: string;
  groups: InfoGroup[];
  /** Caveat about what the data can and cannot say. */
  note?: string;
}

export type ClusterReason = 'no-connection' | 'not-redshift' | 'no-identity';

/** Which warehouse the current connection points at, once resolved. */
export type ClusterTarget =
  | { readonly kind: 'provisioned'; readonly region: string; readonly clusterIdentifier: string }
  | {
      readonly kind: 'serverless';
      readonly region: string;
      readonly workgroupName: string;
      /** Storage metrics are dimensioned by Namespace, not Workgroup. */
      readonly namespaceName?: string;
    };

export interface ClusterApi {
  /** Whether this connection can read the control plane at all, and why not. */
  status(): { supported: boolean; reason?: ClusterReason; source: 'live' | 'demo' | 'none' };
  readonly onDidChange: vscode.Event<void>;
  /**
   * The resolved AWS target, when there is one.
   *
   * Pro builds its own SDK clients from this rather than borrowing the base's.
   * Resolving the target is shared infrastructure — it is how the *Free*
   * Properties section finds its cluster too — but the nine paid sections are
   * Pro's own control-plane reads, and they belong in Pro's source.
   */
  target(): ClusterTarget | undefined;
  /**
   * The rows of one Cluster-view section, flattened to label/value pairs.
   *
   * Narrow on purpose. The paid CLI generator needs the workgroup's CURRENT
   * config parameters because `update-workgroup --config-parameters` REPLACES
   * the whole set — a command that names only the parameter you are changing
   * silently resets every other one to its default. That is a read of live
   * state, not a rendering concern, so it is exposed as data rather than as the
   * base's section model.
   */
  sectionRows(id: string): Promise<{ label: string; value: string }[]>;
}

// --- Shared computation ------------------------------------------------------

export interface ResultSnapshot {
  columns: { name: string }[];
  rows: unknown[][];
}

export type DiffKind = 'added' | 'removed' | 'changed';

export interface RowDiff {
  kind: DiffKind;
  row: unknown[];
  /** Previous values for a `changed` row (the baseline row). */
  before?: unknown[];
  /** Column indices that differ, for a `changed` row. */
  changedColumns?: number[];
}

export interface CompareResult {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  rows: RowDiff[];
  keyColumns: number[];
}

/**
 * Computations the base owns and Pro reuses.
 *
 * The row diff is here for the same reason `explainText` is on the connections
 * API: it is a **Free** capability — it powers "Compare With Baseline" in the
 * result grid — and the paid table-to-table comparator is that same engine with
 * a different report on top. Reimplementing it in Pro would mean two diff
 * algorithms that have to agree about what "the same row" means, and they would
 * eventually stop agreeing.
 */
export interface AnalysisApi {
  diffRows(base: ResultSnapshot, current: ResultSnapshot, keyColumns?: number[]): CompareResult;
}

// --- UI contribution --------------------------------------------------------

/**
 * A Cluster-view section contributed by Pro.
 *
 * The Cluster view is the finest boundary in the product: one view, ten
 * sections, one Free (Properties) and nine Pro. The base owns the view and
 * Properties; Pro hands over the other nine here. Without this the Free tier
 * would lose a section Diego explicitly kept (M10 §3).
 */
export interface ClusterSectionContribution {
  /** Stable id; also the feature id used for the padlock (redlens.cluster.section.<id>). */
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly icon: string;
  /** Rendered when the user opens the section. */
  show(): void | Promise<void>;
}

/** A section of the Database tree contributed by Pro (today: Security policies). */
export interface ExplorerSectionContribution {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  getChildren(): Promise<ExplorerContributedNode[]>;
}

export interface ExplorerContributedNode {
  readonly label: string;
  readonly description?: string;
  readonly tooltip?: string;
  readonly icon?: string;
  readonly command?: { command: string; title: string; arguments?: unknown[] };
  getChildren?(): Promise<ExplorerContributedNode[]>;
}

export interface UiApi {
  contributeClusterSections(sections: readonly ClusterSectionContribution[]): vscode.Disposable;
  contributeExplorerSection(section: ExplorerSectionContribution): vscode.Disposable;
  /**
   * Apply the user's PII-safe settings to rows before rendering or exporting.
   *
   * Not a convenience — a requirement. PII-safe mode is a promise the whole
   * product makes ("no raw PII reaches the grid, an export, or an AI agent"),
   * and a Pro panel that painted raw rows would break it while the user
   * believed it was on. Enforced by a sweep test over every Pro panel.
   */
  maskRows(columns: readonly { name: string }[], rows: unknown[][]): unknown[][];
  /**
   * Decode a Database-tree node into the object it stands for.
   *
   * Pro's table-scoped commands are invoked from the base's tree and receive
   * its node objects. The shape of those nodes is the base's business and may
   * change; asking here means a Pro command never reaches into an internal
   * structure it does not own. Returns undefined for anything that is not a
   * table.
   */
  decodeTableNode(node: unknown): { schema: string; table: string } | undefined;
  /**
   * Decode a Users & Roles tree node into the identity it stands for.
   *
   * The same reasoning as `decodeTableNode`: the node shape belongs to the base
   * and may change, and classifying a name as federated or system is the base's
   * rule — it is what puts the badge on the tree in the first place. Pro reads
   * the flags rather than re-deriving them from a name, so the two halves can
   * never disagree about whether an identity is administrable.
   */
  decodeIdentityNode(node: unknown): GovernanceIdentity | undefined;
  /** The base's output channel — one log for the product, not one per extension. */
  readonly output: vscode.OutputChannel;
}

// --- Licensing handshake ----------------------------------------------------

/**
 * Pro installs itself as the authority on what is unlocked; the base only ever
 * asks. The direction matters: the base needs no knowledge of Pro's extension
 * id, and "Pro absent, disabled, or not yet activated" collapses into the one
 * correct state — no provider, everything Pro locked.
 */
export interface LicenseProvider {
  isUnlocked(featureId: string): boolean;
  readonly onDidChange: vscode.Event<void>;
}

export interface LicensingApi {
  setProvider(provider: LicenseProvider): vscode.Disposable;
}
