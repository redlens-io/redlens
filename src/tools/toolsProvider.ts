import * as vscode from 'vscode';
import { TOOL_GROUPS, type ToolEntry, type ToolGroup } from './catalog';
import { entryCommand } from '../licensing/padlock';
import type { ProState } from '../licensing/proState';
import type { ConnectionManager } from '../connections/connectionManager';

type Node = { kind: 'group'; group: ToolGroup } | { kind: 'tool'; tool: ToolEntry };

/**
 * The "Tools" view (M9b4): RedLens's own catalog, grouped by intent and
 * collapsed by default — 7 lines that expand, instead of 44 flat entries in the
 * Command Palette. Each leaf runs its command directly.
 *
 * Tools that need a connection stay visible while disconnected but say so, so
 * the view always answers "what can this do?" even before you connect. Clicking
 * one still reaches the command's own explanatory message.
 */
export class ToolsProvider implements vscode.TreeDataProvider<Node> {
  private readonly changeEmitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly sub: vscode.Disposable;
  private readonly proSub: vscode.Disposable;

  constructor(
    private readonly manager: ConnectionManager,
    private readonly pro: ProState,
  ) {
    this.sub = manager.onDidChangeActive(() => this.changeEmitter.fire(undefined));
    // Pro can arrive, leave or change entitlement long after this view first
    // rendered — installing the extension mid-session is the common case — so
    // the padlocks have to be able to redraw without a reload.
    this.proSub = pro.onDidChange(() => this.changeEmitter.fire(undefined));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(
        node.group.label,
        node.group.defaultExpanded === true
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = new vscode.ThemeIcon(node.group.icon);
      item.description = `${node.group.tools.length}`;
      item.contextValue = `redlens.toolGroup.${node.group.id}`;
      return item;
    }
    const t = node.tool;
    const connected = this.manager.getActive() !== undefined;
    const unavailable = t.needsConnection === true && !connected;
    // Pro tools stay visible with a padlock rather than disappearing: you
    // cannot buy what you cannot see, and a feature that vanishes reads as a
    // bug rather than as a tier (M10b5).
    const locked = this.pro.isLocked(t.command);
    const item = new vscode.TreeItem(t.label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon(locked ? 'lock' : unavailable ? 'circle-outline' : t.icon);
    item.description = locked ? 'Pro' : unavailable ? 'needs a connection' : undefined;
    item.tooltip = new vscode.MarkdownString(
      locked
        ? `${t.detail}\n\n_Included in RedLens Pro — the 14-day trial covers it._`
        : unavailable ? `${t.detail}\n\n_Connect first to use this._` : t.detail,
    );
    item.contextValue = locked ? 'redlens.tool.pro' : 'redlens.tool';
    item.command = entryCommand({ featureId: t.command, title: t.label, locked, command: t.command });
    return item;
  }

  getChildren(node?: Node): Node[] {
    if (node === undefined) {
      return TOOL_GROUPS.map((group) => ({ kind: 'group', group }));
    }
    if (node.kind === 'group') {
      return node.group.tools.map((tool) => ({ kind: 'tool', tool }));
    }
    return [];
  }

  dispose(): void {
    this.sub.dispose();
    this.proSub.dispose();
    this.changeEmitter.dispose();
  }
}
