import * as vscode from 'vscode';
import { CLUSTER_SECTIONS, type ClusterSectionId } from '../aws/clusterInfo';
import { clusterSectionFeature } from '../licensing/tiers';
import { entryCommand } from '../licensing/padlock';
import { BASE_RENDERED_SECTIONS } from './ownedSections';
import type { ClusterService } from '../aws/clusterService';
import type { ProState } from '../licensing/proState';
import type { ContributionRegistry } from '../api/contributions';

export interface ClusterNode {
  kind: 'section' | 'message';
  id?: ClusterSectionId;
  label: string;
  detail?: string;
  icon?: string;
  /** Pro section with nobody to render it — draws a padlock, offers the upsell. */
  locked?: boolean;
}

/**
 * The "Cluster" view (M10b2): the Redshift console's configuration, in the
 * sidebar. Read-only by design — this view answers "how is this warehouse set
 * up", and nothing here can change it.
 *
 * Since the open-core split (Fase O) this view straddles the tier boundary:
 * **Properties is Free and the other nine sections are Pro.** The base owns the
 * view and the section list; Pro contributes the nine it implements, through
 * `ui.contributeClusterSections`.
 *
 * The section list stays here, in the open extension, even for sections the
 * base cannot render. That is the point: a Free user sees all ten rows, nine of
 * them padlocked and each still saying what it would show. A view that is
 * simply nine rows shorter tells them nothing — and nobody buys what they
 * cannot see (M10b5).
 *
 * When the connection has no AWS identity the view says so in its own tree
 * instead of showing sections that would all fail on click.
 */
export class ClusterProvider implements vscode.TreeDataProvider<ClusterNode>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<ClusterNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly subs: vscode.Disposable[] = [];

  constructor(
    private readonly service: ClusterService,
    private readonly pro: ProState,
    private readonly contributions: ContributionRegistry,
  ) {
    this.subs.push(service.onDidChange(() => this.changeEmitter.fire(undefined)));
    // Installing Pro mid-session must turn nine padlocks into nine sections
    // without a window reload.
    this.subs.push(pro.onDidChange(() => this.changeEmitter.fire(undefined)));
    this.subs.push(contributions.onDidChange(() => this.changeEmitter.fire(undefined)));
  }

  getTreeItem(node: ClusterNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    if (node.kind === 'message') {
      item.iconPath = new vscode.ThemeIcon('info');
      item.tooltip = new vscode.MarkdownString(node.detail ?? '');
      item.contextValue = 'redlens.clusterMessage';
      return item;
    }
    if (node.locked === true) {
      item.iconPath = new vscode.ThemeIcon('lock');
      item.description = 'Pro';
      item.tooltip = new vscode.MarkdownString(
        `${node.detail ?? ''}\n\n_Included in RedLens Pro — the 14-day trial covers it._`,
      );
      item.contextValue = 'redlens.clusterSection.pro';
      item.command = entryCommand({
        featureId: clusterSectionFeature(node.id ?? ''),
        title: node.label,
        locked: true,
      });
      return item;
    }
    item.iconPath = new vscode.ThemeIcon(node.icon ?? 'server');
    item.tooltip = new vscode.MarkdownString(node.detail ?? '');
    item.contextValue = 'redlens.clusterSection';
    item.command = {
      command: 'redlens.cluster.showSection',
      title: node.label,
      arguments: [node.id],
    };
    return item;
  }

  getChildren(node?: ClusterNode): ClusterNode[] {
    if (node !== undefined) {
      return [];
    }
    const status = this.service.status();
    if (!status.supported) {
      return [{ kind: 'message', label: messageFor(status.reason), detail: DETAIL }];
    }
    return CLUSTER_SECTIONS.map((s) => {
      const feature = clusterSectionFeature(s.id);
      // Locked means "this tier does not include it". Unlocked but
      // uncontributed means the entitlement is fine and Pro simply is not
      // installed — same padlock, and the upsell tells the two apart.
      const renderable =
        !this.pro.isLocked(feature)
        && (this.ownedByBase(s.id) || this.contributions.findClusterSection(s.id) !== undefined);
      return {
        kind: 'section' as const,
        id: s.id,
        label: s.title,
        detail: s.detail,
        icon: s.icon,
        ...(renderable ? {} : { locked: true }),
      };
    });
  }

  /** Sections whose renderer lives in this extension — see BASE_RENDERED_SECTIONS. */
  private ownedByBase(id: ClusterSectionId): boolean {
    return BASE_RENDERED_SECTIONS.includes(id);
  }

  dispose(): void {
    for (const s of this.subs) {
      s.dispose();
    }
    this.changeEmitter.dispose();
  }
}

const DETAIL =
  'The Cluster view reads the Redshift control plane (redshift:Describe* / redshift-serverless:Get*) '
  + 'with your AWS credentials, and needs to know which cluster or workgroup this connection points at.';

function messageFor(reason: string | undefined): string {
  switch (reason) {
    case 'no-connection':
      return 'Connect to a warehouse';
    case 'not-redshift':
      return 'Not an Amazon Redshift connection';
    default:
      return 'No AWS identity for this connection';
  }
}
