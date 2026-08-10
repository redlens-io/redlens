import * as vscode from 'vscode';
import type { ClusterSectionContribution, ExplorerSectionContribution } from './contract';

/**
 * Where Pro's UI plugs into the base's trees (Fase O).
 *
 * Two trees in the product are genuinely mixed-tier and cannot simply belong to
 * one side or the other:
 *
 *  - **Cluster**: ten sections, one Free (Properties) and nine Pro. Handing the
 *    whole view to Pro would take Properties away from Free users, which Diego
 *    kept deliberately (M10 §3); keeping it all in the base would mean shipping
 *    the paid console in the open repo.
 *  - **Database**: the tree is Free, but its *Security policies* section is Pro
 *    (PLAN-M8 §8).
 *
 * So the base owns both trees and Pro contributes into them. The registry is
 * the seam. It stays deliberately dumb — a list plus a change event — because
 * the interesting behaviour (padlocks, upsell) belongs to the tree providers
 * that read it, where the Free-tier rules already live.
 */
export class ContributionRegistry implements vscode.Disposable {
  private clusterSections: readonly ClusterSectionContribution[] = [];
  private explorerSections: ExplorerSectionContribution[] = [];

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  addClusterSections(sections: readonly ClusterSectionContribution[]): vscode.Disposable {
    const added = [...sections];
    this.clusterSections = [...this.clusterSections, ...added];
    this.changeEmitter.fire();
    return new vscode.Disposable(() => {
      this.clusterSections = this.clusterSections.filter((s) => !added.includes(s));
      this.changeEmitter.fire();
    });
  }

  addExplorerSection(section: ExplorerSectionContribution): vscode.Disposable {
    this.explorerSections.push(section);
    this.changeEmitter.fire();
    return new vscode.Disposable(() => {
      this.explorerSections = this.explorerSections.filter((s) => s !== section);
      this.changeEmitter.fire();
    });
  }

  /** Cluster sections contributed by Pro, in contribution order. */
  getClusterSections(): readonly ClusterSectionContribution[] {
    return this.clusterSections;
  }

  getExplorerSections(): readonly ExplorerSectionContribution[] {
    return this.explorerSections;
  }

  /**
   * Look up a contributed cluster section by id.
   *
   * Returns undefined when Pro is absent, which is what lets the base render
   * the nine paid sections as padlocks it can describe but not open — the user
   * sees the shape of what they are missing instead of a view that is simply
   * nine rows shorter.
   */
  findClusterSection(id: string): ClusterSectionContribution | undefined {
    return this.clusterSections.find((s) => s.id === id);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
