import * as vscode from 'vscode';
import { gatedCommand } from '../licensing/gate';
import { clusterSectionFeature } from '../licensing/tiers';
import { ClusterPanel } from '../cluster/clusterPanel';
import type { ClusterService } from '../aws/clusterService';
import type { ClusterSectionId } from '../aws/clusterInfo';
import type { CloudWatchTarget } from '../aws/target';
import type { ProState } from '../licensing/proState';

/**
 * M10b2 commands for the Cluster view. Everything here is read-only: the
 * console can pause, resize and delete a warehouse, and an extension that can
 * do that with one click is an accident waiting to happen. Acting on the
 * cluster arrives in b4 as generated `aws` CLI you review yourself.
 */
export function registerClusterCommands(
  context: vscode.ExtensionContext,
  service: ClusterService,
  pro?: ProState,
): void {
  const panel = new ClusterPanel();
  context.subscriptions.push(panel);

  async function open(id: ClusterSectionId): Promise<void> {
    // The tree item is one command for ten sections, so the tier check has to
    // happen per section: Properties is Free, the rest is Pro (M10b5).
    const feature = clusterSectionFeature(id);
    if (pro !== undefined && pro.isLocked(feature)) {
      void vscode.commands.executeCommand('redlens.proUpsell', feature);
      return;
    }
    const status = service.status();
    if (!status.supported || status.target === undefined) {
      void vscode.window.showInformationMessage(`RedLens: ${unavailableNote(status.reason)}`);
      return;
    }
    try {
      const section = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'RedLens: reading the Redshift control plane…' },
        () => service.section(id),
      );
      panel.show(section, targetLabel(status.target), status.source === 'demo' ? 'demo' : 'live');
    } catch (err) {
      // The AWS message names the missing permission or the expired token —
      // that is the fix, so it goes in front of the user unedited.
      void vscode.window.showErrorMessage(
        `RedLens: couldn't read the cluster configuration — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  context.subscriptions.push(
    gatedCommand('redlens.cluster.showSection', (id?: ClusterSectionId) => open(id ?? 'properties')),
    gatedCommand('redlens.showCluster', () => open('properties')),
    gatedCommand('redlens.refreshCluster', () => {
      service.invalidate();
      void vscode.window.setStatusBarMessage('RedLens: cluster configuration reloaded', 2000);
    }),

    // "Add CloudWatch and the console view" quietly means "ask your platform
    // team for permissions". This is that request, written for them: read-only,
    // with every statement explaining what breaks without it.
    // b4: the console can pause, resize and reconfigure. RedLens writes the
    // command and hands it to you — it never calls a mutating API.
  );

  /** Prompt for each parameter; undefined means the user backed out. */
  /** The workgroup's current config parameters, best effort. */
}

function targetLabel(target: CloudWatchTarget): string {
  return target.kind === 'provisioned'
    ? `Provisioned · ${target.clusterIdentifier} · ${target.region}`
    : `Serverless · ${target.workgroupName} · ${target.region}`;
}

function unavailableNote(reason: string | undefined): string {
  switch (reason) {
    case 'no-connection':
      return 'connect first — the Cluster view reads the configuration of the warehouse you are connected to.';
    case 'not-redshift':
      return 'the Cluster view needs an Amazon Redshift connection (this one is plain Postgres or the demo warehouse).';
    default:
      return 'this connection has no AWS identity. Data API connections carry it; for a direct connection it is read from '
        + 'the endpoint host, or set "aws": { "region": "…", "clusterIdentifier": "…" } (or "workgroupName") on the profile.';
  }
}
