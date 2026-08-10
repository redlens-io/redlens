import * as vscode from 'vscode';
import { DescribeClustersCommand, RedshiftClient } from '@aws-sdk/client-redshift';
import {
  GetNamespaceCommand, GetWorkgroupCommand, RedshiftServerlessClient,
} from '@aws-sdk/client-redshift-serverless';
import { resolveTarget, type CloudWatchTarget, type UnavailableReason } from './target';
import {
  provisionedProperties, serverlessProperties,
  type ClusterSectionId, type ProvisionedCluster, type SectionModel,
  type ServerlessNamespace, type ServerlessWorkgroup,
} from './clusterInfo';
import { DEMO_NAMESPACE, DEMO_WORKGROUP } from './clusterFixtures';
import type { ActiveConnection, ConnectionManager } from '../connections/connectionManager';

export type ClusterReason = UnavailableReason | 'no-connection';

export interface ClusterStatus {
  supported: boolean;
  reason?: ClusterReason;
  target?: CloudWatchTarget;
  source: 'live' | 'demo' | 'none';
}

/**
 * The Cluster view's data source, for the one section this extension owns.
 *
 * Since the Fase O split that is Properties — Free by an explicit decision
 * (M10 §3). The other nine sections are read by RedLens Pro with its own SDK
 * clients and contributed back through `ui.contributeClusterSections`, so the
 * open package carries none of the paid console's control-plane reads.
 *
 * Read-only by construction, and the split did not loosen it: the only commands
 * imported here are Describe/Get. Changing a warehouse is `scriptClusterAction`
 * in the Pro package, which writes an `aws` command for a human to run.
 */
interface ClusterSource {
  readonly supported: boolean;
  readonly reason?: ClusterReason;
  readonly target?: CloudWatchTarget;
  readonly kind: 'live' | 'demo' | 'none';
  section(id: ClusterSectionId): Promise<SectionModel>;
}

class UnsupportedClusterSource implements ClusterSource {
  readonly supported = false;
  readonly kind = 'none' as const;
  constructor(readonly reason: ClusterReason) {}

  async section(): Promise<SectionModel> {
    throw new Error('The Cluster view is not available for this connection');
  }
}

class DemoClusterSource implements ClusterSource {
  readonly supported = true;
  readonly kind = 'demo' as const;
  constructor(readonly target: CloudWatchTarget) {}

  async section(): Promise<SectionModel> {
    return serverlessProperties(DEMO_WORKGROUP, DEMO_NAMESPACE);
  }
}

class SdkClusterSource implements ClusterSource {
  readonly supported = true;
  readonly kind = 'live' as const;
  private provisioned: RedshiftClient | undefined;
  private serverless: RedshiftServerlessClient | undefined;

  constructor(readonly target: CloudWatchTarget) {}

  async section(): Promise<SectionModel> {
    return this.target.kind === 'provisioned' ? this.readProvisioned() : this.readServerless();
  }

  private async readProvisioned(): Promise<SectionModel> {
    if (this.target.kind !== 'provisioned') {
      throw new Error('wrong target kind');
    }
    const client = (this.provisioned ??= new RedshiftClient({ region: this.target.region }));
    const out = await client.send(
      new DescribeClustersCommand({ ClusterIdentifier: this.target.clusterIdentifier }),
    );
    const cluster = (out.Clusters ?? [])[0] as ProvisionedCluster | undefined;
    if (cluster === undefined) {
      throw new Error(`No cluster named ${this.target.clusterIdentifier} in ${this.target.region}`);
    }
    return provisionedProperties(cluster);
  }

  private async readServerless(): Promise<SectionModel> {
    if (this.target.kind !== 'serverless') {
      throw new Error('wrong target kind');
    }
    const client = (this.serverless ??= new RedshiftServerlessClient({ region: this.target.region }));
    const wgOut = await client.send(new GetWorkgroupCommand({ workgroupName: this.target.workgroupName }));
    const workgroup = wgOut.workgroup as ServerlessWorkgroup | undefined;
    if (workgroup === undefined) {
      throw new Error(`No workgroup named ${this.target.workgroupName} in ${this.target.region}`);
    }
    // The namespace holds the database, KMS key and IAM roles Properties shows.
    // It is a separate permission: losing it must not lose the workgroup half.
    let namespace: ServerlessNamespace | undefined;
    if (workgroup.namespaceName !== undefined) {
      try {
        const nsOut = await client.send(new GetNamespaceCommand({ namespaceName: workgroup.namespaceName }));
        namespace = nsOut.namespace as ServerlessNamespace | undefined;
      } catch {
        namespace = undefined;
      }
    }
    return serverlessProperties(workgroup, namespace);
  }

  dispose(): void {
    this.provisioned?.destroy();
    this.serverless?.destroy();
  }
}

export class ClusterService implements vscode.Disposable {
  private source: ClusterSource = new UnsupportedClusterSource('no-connection');
  private readonly cache = new Map<string, Promise<SectionModel>>();
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly sub: vscode.Disposable;

  constructor(manager: ConnectionManager) {
    this.reset(manager.getActive());
    this.sub = manager.onDidChangeActive((active) => this.reset(active));
  }

  private reset(active: ActiveConnection | undefined): void {
    this.cache.clear();
    if (this.source instanceof SdkClusterSource) {
      this.source.dispose();
    }
    if (active === undefined) {
      this.source = new UnsupportedClusterSource('no-connection');
    } else if (active.profile.kind === 'demo') {
      this.source = new DemoClusterSource({
        kind: 'serverless', region: 'us-east-1', workgroupName: 'redlens-demo', namespaceName: 'redlens-demo',
      });
    } else {
      const { target, reason } = resolveTarget(active.profile);
      this.source = target === undefined
        ? new UnsupportedClusterSource(reason ?? 'no-identity')
        : new SdkClusterSource(target);
    }
    this.changeEmitter.fire();
  }

  status(): ClusterStatus {
    return {
      supported: this.source.supported,
      reason: this.source.reason,
      target: this.source.target,
      source: this.source.kind,
    };
  }

  section(id: ClusterSectionId): Promise<SectionModel> {
    if (!this.source.supported) {
      return Promise.reject(new Error('The Cluster view is not available for this connection'));
    }
    let hit = this.cache.get(id);
    if (hit === undefined) {
      hit = this.source.section(id).catch((err: unknown) => {
        // Never cache a failure: a denied permission or an expired token is
        // something the user fixes and retries within the same session.
        this.cache.delete(id);
        throw err;
      });
      this.cache.set(id, hit);
    }
    return hit;
  }

  invalidate(): void {
    this.cache.clear();
    this.changeEmitter.fire();
  }

  dispose(): void {
    if (this.source instanceof SdkClusterSource) {
      this.source.dispose();
    }
    this.sub.dispose();
    this.changeEmitter.dispose();
  }
}
