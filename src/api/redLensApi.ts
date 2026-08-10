import * as vscode from 'vscode';
import { queryAll } from '../query/collect';
import { compareResults } from '../grid/compareResults';
import { explain } from '../explain/explainService';
import { planToText } from '../explain/planText';
import { tableNodeToPreviewArgs } from '../explorer/explorerProvider';
import { maskRows as maskRowsPure } from '../pii/piiMask';
import { readPiiConfig } from '../pii/piiSettings';
import type {
  ActiveConnectionInfo, AnalysisApi, ClusterApi, ClusterTarget, ConnectionsApi, GovernanceApi,
  GovernanceIdentity, LicensingApi, MetadataApi, QueryRows, RedLensApi, RedLensExports, UiApi,
} from './contract';
import type { ConnectionManager } from '../connections/connectionManager';
import type { MetadataService } from '../metadata/metadataService';
import type { GovernanceService } from '../redshift/governanceService';
import type { ClusterService } from '../aws/clusterService';
import type { ProState } from '../licensing/proState';
import type { ContributionRegistry } from './contributions';

/**
 * The base's half of the bridge (Fase O).
 *
 * Everything here is an adapter, never a second implementation: the API hands
 * Pro the same services the base's own UI uses, narrowed to what a paid feature
 * is allowed to know. Two narrowings are load-bearing rather than tidy:
 *
 *  - `ActiveConnectionInfo` exposes the safety flags but no transport handle,
 *    so Pro can read `readOnly`/`production` but cannot execute around them.
 *  - `query()` is the only way in, and it goes through the same `queryAll` the
 *    base uses. Every safety feature is Free, and Free code stays authoritative
 *    over paid code.
 */
export function createRedLensExports(deps: {
  manager: ConnectionManager;
  metadata: MetadataService;
  governance: GovernanceService;
  cluster: ClusterService;
  contributions: ContributionRegistry;
  pro: ProState;
  output: vscode.OutputChannel;
  baseVersion: string;
}): RedLensExports {
  const api: RedLensApi = {
    apiVersion: 1,
    baseVersion: deps.baseVersion,
    connections: connectionsApi(deps.manager),
    metadata: metadataApi(deps.metadata),
    governance: governanceApi(deps.governance),
    cluster: clusterApi(deps.cluster),
    analysis: analysisApi(),
    ui: uiApi(deps.contributions, deps.output),
    licensing: licensingApi(deps.pro),
  };

  return {
    getApi(version: 1): RedLensApi | undefined {
      // Deliberately exact. A future base that drops v1 returns undefined here
      // and Pro reports "this version of RedLens Pro needs an older/newer
      // RedLens" — instead of failing later, deeper, and less legibly.
      return version === 1 ? api : undefined;
    },
  };
}

function connectionsApi(manager: ConnectionManager): ConnectionsApi {
  const changeEmitter = new vscode.EventEmitter<void>();
  manager.onDidChangeActive(() => changeEmitter.fire());

  return {
    getActive(): ActiveConnectionInfo | undefined {
      const active = manager.getActive();
      if (active === undefined) {
        return undefined;
      }
      const aws = active.profile.aws;
      return {
        profileId: active.profile.id,
        profileName: active.profile.name,
        database: active.profile.database,
        kind: active.profile.kind,
        readOnly: active.readOnly,
        production: active.production,
        autoCommit: active.autoCommit,
        inTransaction: active.inTransaction,
        ...(aws?.region !== undefined
          ? {
              aws: {
                region: aws.region,
                ...(aws.clusterIdentifier !== undefined ? { clusterIdentifier: aws.clusterIdentifier } : {}),
                ...(aws.workgroupName !== undefined ? { workgroupName: aws.workgroupName } : {}),
                ...(aws.namespaceName !== undefined ? { namespaceName: aws.namespaceName } : {}),
              },
            }
          : {}),
      };
    },
    onDidChangeActive: changeEmitter.event,
    async query(sql: string): Promise<QueryRows> {
      const active = manager.getActive();
      if (active === undefined) {
        throw new Error('No active connection');
      }
      return queryAll(active.transport, sql);
    },
    async explainText(sql: string, analyze = false) {
      const active = manager.getActive();
      if (active === undefined) {
        throw new Error('No active connection');
      }
      const result = await explain(active, sql, analyze);
      // Plan warnings are structured in the base; the contract deliberately
      // carries text, so the AI prompt cannot depend on an internal shape.
      return { planText: planToText(result.nodes), warnings: result.warnings.map((w) => `${w.title}: ${w.advice}`) };
    },
    getLastFailure() {
      return manager.getLastFailure();
    },
  };
}

function metadataApi(metadata: MetadataService): MetadataApi {
  return {
    onDidChange: metadata.onDidChange,
    hasSource: () => metadata.hasSource(),
    listSchemas: () => metadata.listSchemas(),
    listTables: (schema) => metadata.listTables(schema),
    listColumns: (schema, table) => metadata.listColumns(schema, table),
    listPrimaryKey: (schema, table) => metadata.listPrimaryKey(schema, table),
    cachedSchemas: () => metadata.cachedSchemas(),
    cachedTables: (schema) => metadata.cachedTables(schema),
    cachedColumns: (schema, table) => metadata.cachedColumns(schema, table),
  };
}

function governanceApi(governance: GovernanceService): GovernanceApi {
  return {
    supported: () => governance.supported(),
    async listUsers() {
      const users = await governance.users();
      return users.map(toIdentity);
    },
    async listRoles() {
      const roles = await governance.roles();
      return roles.map((r) => ({ name: r.name, kind: 'role' as const }));
    },
    effectivePermissions: (ref, userName) => governance.effectivePermissions(ref, userName),
    invalidate: () => governance.invalidate(),
  };
}

/** DbUser → the narrowed identity the bridge exposes. */
function toIdentity(u: {
  name: string; federated?: boolean; system?: boolean; superuser?: boolean; createDb?: boolean;
}): GovernanceIdentity {
  return {
    name: u.name,
    kind: 'user',
    ...(u.federated === true ? { federated: true } : {}),
    ...(u.system === true ? { system: true } : {}),
    ...(u.superuser === true ? { superuser: true } : {}),
    ...(u.createDb === true ? { createDb: true } : {}),
  };
}

function clusterApi(cluster: ClusterService): ClusterApi {
  return {
    status() {
      const s = cluster.status();
      return {
        supported: s.supported,
        ...(s.reason !== undefined ? { reason: s.reason } : {}),
        source: s.source,
      };
    },
    onDidChange: cluster.onDidChange,
    target(): ClusterTarget | undefined {
      return cluster.status().target;
    },
    async sectionRows(id) {
      const section = await cluster.section(id as Parameters<typeof cluster.section>[0]);
      return section.groups.flatMap((g) => g.rows).map((r) => ({ label: r.label, value: r.value }));
    },
  };
}

function analysisApi(): AnalysisApi {
  // A straight pass-through: the point is that there is exactly one
  // implementation, not that the bridge adds anything to it.
  return { diffRows: (base, current, keyColumns) => compareResults(base, current, keyColumns) };
}

function uiApi(contributions: ContributionRegistry, output: vscode.OutputChannel): UiApi {
  return {
    contributeClusterSections: (sections) => contributions.addClusterSections(sections),
    contributeExplorerSection: (section) => contributions.addExplorerSection(section),
    maskRows(columns, rows) {
      // Reads the setting on every call rather than caching it: PII-safe mode
      // is a toggle the user flips mid-session expecting it to take effect on
      // what is already open (UXD-031).
      return maskRowsPure([...columns], rows, readPiiConfig());
    },
    decodeTableNode(node) {
      return tableNodeToPreviewArgs(node);
    },
    decodeIdentityNode(node) {
      if (typeof node !== 'object' || node === null) {
        return undefined;
      }
      const n = node as { type?: string; user?: Parameters<typeof toIdentity>[0]; role?: { name: string } };
      if (n.type === 'user' && n.user !== undefined) {
        return toIdentity(n.user);
      }
      if (n.type === 'role' && n.role !== undefined) {
        return { name: n.role.name, kind: 'role' };
      }
      return undefined;
    },
    output,
  };
}

function licensingApi(pro: ProState): LicensingApi {
  return {
    setProvider: (provider) => pro.setProvider(provider),
  };
}
