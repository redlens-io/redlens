import * as vscode from 'vscode';
import type { ProState } from '../licensing/proState';
import type { ConnectionManager } from '../connections/connectionManager';
import type { MetadataService } from '../metadata/metadataService';
import type { GovernanceService } from '../redshift/governanceService';
import type { TableInfo } from '../metadata/types';
import type { Datashare, DatashareConsumer, DatashareObject, DbRole, DbUser } from '../redshift/governance';

type Node =
  | SectionNode
  | SchemaNode
  | TableNode
  | ColumnNode
  | InfoNode
  | DatashareNode
  | DsGroupNode
  | DsObjectNode
  | DsConsumerNode
  | SecurityGroupNode
  | UserNode
  | RoleNode
  | PolicyGroupNode
  | PolicyNode;

interface InfoNode {
  type: 'info';
  label: string;
}

/** Top-level grouping (M8): only rendered on Redshift/demo connections. */
interface SectionNode {
  type: 'section';
  section: 'schemas' | 'datashares' | 'security' | 'policies';
}

interface SchemaNode {
  type: 'schema';
  schema: string;
}

interface TableNode {
  type: 'table';
  table: TableInfo;
}

interface ColumnNode {
  type: 'column';
  label: string;
  detail: string;
}

interface DatashareNode {
  type: 'datashare';
  share: Datashare;
}

interface DsGroupNode {
  type: 'dsGroup';
  share: Datashare;
  group: 'objects' | 'consumers';
}

interface DsObjectNode {
  type: 'dsObject';
  share: Datashare;
  object: DatashareObject;
}

interface DsConsumerNode {
  type: 'dsConsumer';
  consumer: DatashareConsumer;
}

interface SecurityGroupNode {
  type: 'securityGroup';
  group: 'users' | 'roles';
}

interface UserNode {
  type: 'user';
  user: DbUser;
}

interface RoleNode {
  type: 'role';
  role: DbRole;
}

interface PolicyGroupNode {
  type: 'policyGroup';
  group: 'rls' | 'masking';
}

interface PolicyNode {
  type: 'policy';
  kind: 'rls' | 'masking';
  label: string;
  detail: string;
  tooltip: string;
}

const TABLE_ICONS: Record<TableInfo['kind'], vscode.ThemeIcon> = {
  table: new vscode.ThemeIcon('table'),
  view: new vscode.ThemeIcon('eye'),
  external: new vscode.ThemeIcon('cloud'),
};

const Collapsed = vscode.TreeItemCollapsibleState.Collapsed;
const None = vscode.TreeItemCollapsibleState.None;

/**
 * Lazy tree over MetadataService + GovernanceService. On Redshift/demo the root
 * splits into Schemas / Datashares / Users & Roles sections (M8b1 — the
 * discoverability fix); on plain-Postgres it stays a flat schema list. Empty and
 * error states become explicit info nodes, never a silent blank (UXD-018/§7.5).
 */
export class ExplorerProvider implements vscode.TreeDataProvider<Node> {
  private readonly changeEmitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly manager: ConnectionManager,
    private readonly metadata: MetadataService,
    private readonly governance: GovernanceService,
    private readonly pro: ProState,
  ) {
    metadata.onDidChange(() => this.changeEmitter.fire(undefined));
    governance.onDidChange(() => this.changeEmitter.fire(undefined));
    pro.onDidChange(() => this.changeEmitter.fire(undefined));
  }

  refresh(): void {
    this.metadata.invalidate();
    this.governance.invalidate();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.type) {
      case 'section': {
        const meta = {
          schemas: { label: 'Schemas', icon: 'symbol-namespace' },
          datashares: { label: 'Datashares', icon: 'link' },
          security: { label: 'Users & Roles', icon: 'organization' },
          policies: { label: 'Security policies', icon: 'lock' },
        }[node.section];
        const item = new vscode.TreeItem(meta.label, Collapsed);
        item.iconPath = new vscode.ThemeIcon(meta.icon);
        item.contextValue = `redlens.section.${node.section}`;
        // Expand Schemas by default so existing muscle memory is undisturbed.
        if (node.section === 'schemas') {
          item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        }
        return item;
      }
      case 'schema': {
        const item = new vscode.TreeItem(node.schema, Collapsed);
        item.iconPath = new vscode.ThemeIcon('symbol-namespace');
        item.contextValue = 'redlens.schema';
        return item;
      }
      case 'table': {
        const item = new vscode.TreeItem(node.table.name, Collapsed);
        item.iconPath = TABLE_ICONS[node.table.kind];
        item.description = node.table.kind === 'table' ? undefined : node.table.kind;
        item.contextValue = 'redlens.table';
        item.tooltip = `${node.table.schema}.${node.table.name} — click the inline icon to preview 100 rows`;
        return item;
      }
      case 'column': {
        const item = new vscode.TreeItem(node.label, None);
        item.iconPath = new vscode.ThemeIcon('symbol-field');
        item.description = node.detail;
        return item;
      }
      case 'datashare': {
        const s = node.share;
        const item = new vscode.TreeItem(s.name, Collapsed);
        item.iconPath = new vscode.ThemeIcon(s.direction === 'outbound' ? 'export' : 'import');
        const bits = [s.direction.toUpperCase()];
        if (s.publicAccessible) bits.push('public');
        item.description = bits.join(' · ');
        item.contextValue = `redlens.datashare.${s.direction}`;
        item.tooltip = datashareTooltip(s);
        return item;
      }
      case 'dsGroup': {
        const item = new vscode.TreeItem(node.group === 'objects' ? 'Shared objects' : 'Consumers', Collapsed);
        item.iconPath = new vscode.ThemeIcon(node.group === 'objects' ? 'symbol-structure' : 'account');
        return item;
      }
      case 'dsObject': {
        const o = node.object;
        const item = new vscode.TreeItem(o.objectName, None);
        item.iconPath = new vscode.ThemeIcon(o.objectType === 'schema' ? 'symbol-namespace' : o.objectType === 'view' ? 'eye' : 'table');
        item.description = o.objectType;
        item.contextValue = 'redlens.dsObject';
        // Query action carries the share (direction decides 2- vs 3-part name).
        item.command = {
          command: 'redlens.datashare.queryObject',
          title: 'Query shared object',
          arguments: [{ share: node.share, object: o }],
        };
        return item;
      }
      case 'dsConsumer': {
        const c = node.consumer;
        const label = c.consumerNamespace ?? c.consumerAccount ?? 'consumer';
        const item = new vscode.TreeItem(label, None);
        item.iconPath = new vscode.ThemeIcon('account');
        item.description = [c.consumerAccount, c.consumerRegion].filter(Boolean).join(' · ');
        return item;
      }
      case 'securityGroup': {
        const item = new vscode.TreeItem(node.group === 'users' ? 'Users' : 'Roles', Collapsed);
        item.iconPath = new vscode.ThemeIcon(node.group === 'users' ? 'person' : 'shield');
        item.contextValue = `redlens.securityGroup.${node.group}`;
        return item;
      }
      case 'user': {
        const u = node.user;
        const item = new vscode.TreeItem(u.name, None);
        item.iconPath = new vscode.ThemeIcon(u.system ? 'gear' : u.federated ? 'link-external' : 'person');
        const badges: string[] = [];
        if (u.superuser) badges.push('superuser');
        if (u.createDb) badges.push('createdb');
        if (u.federated) badges.push('federated');
        if (u.system) badges.push('system');
        item.description = badges.join(' · ');
        item.contextValue = u.system ? 'redlens.user.system' : u.federated ? 'redlens.user.federated' : 'redlens.user';
        item.tooltip = u.federated
          ? `${u.name} — externally-managed identity (IAM/IdC/IdP). User admin is disabled for federated identities.`
          : u.system
            ? `${u.name} — internal AWS user. Excluded from admin actions.`
            : u.name;
        return item;
      }
      case 'role': {
        const r = node.role;
        const item = new vscode.TreeItem(r.name, None);
        item.iconPath = new vscode.ThemeIcon('shield');
        const badges: string[] = [];
        if (r.system) badges.push('built-in');
        if (r.owner) badges.push(`owner: ${r.owner}`);
        item.description = badges.join(' · ');
        item.contextValue = r.system ? 'redlens.role.system' : 'redlens.role';
        return item;
      }
      case 'policyGroup': {
        const item = new vscode.TreeItem(node.group === 'rls' ? 'Row-level security' : 'Dynamic masking', Collapsed);
        item.iconPath = new vscode.ThemeIcon(node.group === 'rls' ? 'list-filter' : 'eye-closed');
        return item;
      }
      case 'policy': {
        const item = new vscode.TreeItem(node.label, None);
        item.iconPath = new vscode.ThemeIcon(node.kind === 'rls' ? 'list-filter' : 'eye-closed');
        item.description = node.detail;
        item.tooltip = node.tooltip;
        return item;
      }
      case 'info': {
        // Empty/error states must SAY so (§7.5 #4) — a silent blank reads as
        // "broken" (Diego, 2026-07-22).
        const item = new vscode.TreeItem(node.label, None);
        item.iconPath = new vscode.ThemeIcon('info');
        return item;
      }
    }
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (this.manager.getActive() === undefined) {
      return [];
    }
    try {
      if (node === undefined) {
        return await this.rootChildren();
      }
      if (node.type === 'section') {
        return await this.sectionChildren(node.section);
      }
      if (node.type === 'schema') {
        return await this.schemaChildren(node.schema);
      }
      if (node.type === 'table') {
        return await this.tableChildren(node.table);
      }
      if (node.type === 'datashare') {
        return [
          { type: 'dsGroup', share: node.share, group: 'objects' },
          { type: 'dsGroup', share: node.share, group: 'consumers' },
        ];
      }
      if (node.type === 'dsGroup') {
        return await this.dsGroupChildren(node);
      }
      if (node.type === 'securityGroup') {
        return await this.securityGroupChildren(node.group);
      }
      if (node.type === 'policyGroup') {
        return await this.policyGroupChildren(node.group);
      }
    } catch (err) {
      return [{ type: 'info', label: `${describe(err)} Click ↻ to retry.` }];
    }
    return [];
  }

  private async rootChildren(): Promise<Node[]> {
    // Plain-Postgres (compat): keep the flat schema list — no governance surface.
    if (!this.governance.supported()) {
      return this.schemaSection();
    }
    return [
      { type: 'section', section: 'schemas' },
      { type: 'section', section: 'datashares' },
      { type: 'section', section: 'security' },
      { type: 'section', section: 'policies' },
    ];
  }

  private async sectionChildren(section: SectionNode['section']): Promise<Node[]> {
    if (section === 'schemas') {
      return this.schemaSection();
    }
    if (section === 'datashares') {
      const shares = await this.governance.datashares();
      if (shares.length === 0) {
        return [{ type: 'info', label: 'No datashares for this namespace' }];
      }
      return shares.map((share) => ({ type: 'datashare', share }));
    }
    if (section === 'security') {
      return [
        { type: 'securityGroup', group: 'users' },
        { type: 'securityGroup', group: 'roles' },
      ];
    }
    // policies
    return [
      { type: 'policyGroup', group: 'rls' },
      { type: 'policyGroup', group: 'masking' },
    ];
  }

  private async policyGroupChildren(group: 'rls' | 'masking'): Promise<Node[]> {
    // RLS and masking are Pro (PLAN-M8 §8). This section is a tree expansion
    // rather than a command, so the command gate never sees it — without this
    // check the tier would exist only on paper. Locked shows what it would
    // show, not an empty node: a section that goes silent reads as broken.
    if (this.pro.isLocked('redlens.governance.securityPolicies')) {
      return [{
        type: 'info',
        label: group === 'rls'
          ? 'Row-level security policies — RedLens Pro'
          : 'Dynamic data masking policies — RedLens Pro',
      }];
    }
    if (group === 'rls') {
      const policies = await this.governance.rlsPolicies();
      if (policies.length === 0) {
        return [{ type: 'info', label: 'No RLS policies (or need superuser/sys:secadmin)' }];
      }
      return policies.map((p) => ({
        type: 'policy',
        kind: 'rls',
        label: p.name,
        detail: p.attachedTo.length ? `on ${p.attachedTo.length}` : 'unattached',
        tooltip: `${p.name}${p.schema ? ` (${p.schema})` : ''}${p.attachedTo.length ? `\nattached to: ${p.attachedTo.join(', ')}` : ''}`,
      }));
    }
    const policies = await this.governance.maskingPolicies();
    if (policies.length === 0) {
      return [{ type: 'info', label: 'No masking policies (or need superuser/sys:secadmin)' }];
    }
    return policies.map((p) => ({
      type: 'policy',
      kind: 'masking',
      label: p.name,
      detail: p.inputColumns ?? '',
      tooltip: `${p.name}${p.inputColumns ? `\nmasks: ${p.inputColumns}` : ''}`,
    }));
  }

  private async schemaSection(): Promise<Node[]> {
    const schemas = await this.metadata.listSchemas();
    if (schemas.length === 0) {
      return [{ type: 'info', label: 'No schemas visible for this user' }];
    }
    return schemas.map((schema) => ({ type: 'schema', schema }));
  }

  private async schemaChildren(schema: string): Promise<Node[]> {
    const tables = await this.metadata.listTables(schema);
    if (tables.length === 0) {
      return [{ type: 'info', label: 'Empty schema — no tables or views' }];
    }
    return tables.map((table) => ({ type: 'table', table }));
  }

  private async tableChildren(table: TableInfo): Promise<Node[]> {
    const columns = await this.metadata.listColumns(table.schema, table.name);
    if (columns.length === 0) {
      return [{ type: 'info', label: 'No visible columns' }];
    }
    return columns.map((c) => ({
      type: 'column',
      label: c.name,
      detail: `${c.typeName}${c.nullable ? '' : ' · not null'}`,
    }));
  }

  private async dsGroupChildren(node: DsGroupNode): Promise<Node[]> {
    if (node.group === 'objects') {
      const objects = await this.governance.datashareObjects(node.share.name);
      if (objects.length === 0) {
        return [{ type: 'info', label: 'No shared objects' }];
      }
      return objects.map((object) => ({ type: 'dsObject', share: node.share, object }));
    }
    const consumers = await this.governance.datashareConsumers(node.share.name);
    if (consumers.length === 0) {
      return [{ type: 'info', label: 'No consumers yet' }];
    }
    return consumers.map((consumer) => ({ type: 'dsConsumer', consumer }));
  }

  private async securityGroupChildren(group: 'users' | 'roles'): Promise<Node[]> {
    if (group === 'users') {
      const users = await this.governance.users();
      if (users.length === 0) {
        return [{ type: 'info', label: 'No users visible' }];
      }
      return users.map((user) => ({ type: 'user', user }));
    }
    const roles = await this.governance.roles();
    if (roles.length === 0) {
      return [{ type: 'info', label: 'No roles (RBAC roles need Redshift; a normal user may see none)' }];
    }
    return roles.map((role) => ({ type: 'role', role }));
  }
}

function datashareTooltip(s: Datashare): string {
  const lines = [`${s.name} — ${s.direction} datashare`];
  if (s.producerNamespace) lines.push(`producer namespace: ${s.producerNamespace}`);
  if (s.producerAccount) lines.push(`producer account: ${s.producerAccount}`);
  if (s.publicAccessible) lines.push('publicly accessible');
  return lines.join('\n');
}

function describe(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Non-superusers can't browse datashares (#17297) or system tables — say so.
  if (/permission|denied|superuser|system table|not authorized/i.test(msg)) {
    return `Partial view — this needs superuser or ACCESS SYSTEM TABLE. (${msg})`;
  }
  return `Could not load — ${msg}.`;
}

export function tableNodeToPreviewArgs(node: unknown): { schema: string; table: string } | undefined {
  if (typeof node === 'object' && node !== null && (node as TableNode).type === 'table') {
    const t = (node as TableNode).table;
    return { schema: t.schema, table: t.name };
  }
  return undefined;
}
