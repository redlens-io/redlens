import * as vscode from 'vscode';
import { gatedCommand } from '../licensing/gate';
import {
  datashareObjectQuery,
  type Datashare,
  type DatashareObject,
} from '../redshift/governance';
import {
  generateGrant,
  generateGrantScript,
  generateRevoke,
  objectLabel,
  type GranteeType,
  type ObjectRef,
  type PrivilegeGrant,
} from '../redshift/privileges';
import { PrivilegesPanel } from '../redshift/privilegesPanel';
import { isFederatedName, isSystemUserName, type DbRole, type DbUser } from '../redshift/governance';
import type { GovernanceService } from '../redshift/governanceService';
import type { ConnectionManager } from '../connections/connectionManager';

/**
 * M8 tree/governance actions:
 *  - b1: query a shared object (direction-aware) + copy the namespace GUID
 *  - b2: show object privileges (incl. RBAC roles + column grants) + generate
 *        reviewable GRANT/REVOKE SQL (never executed).
 */
export function registerGovernanceCommands(
  context: vscode.ExtensionContext,
  governance: GovernanceService,
  manager: ConnectionManager,
): void {
  const privileges = new PrivilegesPanel();
  context.subscriptions.push({ dispose: () => privileges.dispose() });

  context.subscriptions.push(
    gatedCommand(
      'redlens.datashare.queryObject',
      async (arg?: { share: Datashare; object: DatashareObject }) => {
        if (arg === undefined) return;
        await openSql(datashareObjectQuery(arg.share, arg.object));
      },
    ),

    gatedCommand('redlens.datashare.copyNamespace', async () => {
      if (!governance.supported()) {
        void vscode.window.showInformationMessage('RedLens: namespace GUID is a Redshift concept — connect to Redshift.');
        return;
      }
      let ns: string | undefined;
      try {
        ns = await governance.currentNamespace();
      } catch (err) {
        void vscode.window.showWarningMessage(`RedLens: could not read namespace — ${msg(err)}`);
        return;
      }
      if (!ns) {
        void vscode.window.showInformationMessage('RedLens: no namespace GUID returned by SELECT current_namespace.');
        return;
      }
      await vscode.env.clipboard.writeText(ns);
      void vscode.window.showInformationMessage(`RedLens: copied namespace GUID ${ns}`);
    }),

    gatedCommand('redlens.showPrivileges', async (node?: unknown) => {
      const ref = nodeToRef(node);
      if (ref === undefined) {
        void vscode.window.showInformationMessage('RedLens: right-click a table or schema to view its privileges.');
        return;
      }
      if (!governance.supported()) {
        void vscode.window.showInformationMessage('RedLens: object privileges need a Redshift connection.');
        return;
      }
      const active = manager.getActive();
      const source = active?.profile.kind === 'demo' ? 'demo' : 'live';
      const name = active?.profile.name ?? 'RedLens';
      try {
        const priv = await governance.objectPrivileges(ref);
        privileges.show(ref, priv, name, source);
      } catch (err) {
        void vscode.window.showWarningMessage(`RedLens: could not read privileges — ${msg(err)}`);
      }
    }),

    gatedCommand('redlens.scriptGrants', async (node?: unknown) => {
      const ref = nodeToRef(node);
      if (ref === undefined) {
        void vscode.window.showInformationMessage('RedLens: right-click a table or schema to script its grants.');
        return;
      }
      if (!governance.supported()) {
        void vscode.window.showInformationMessage('RedLens: grant scripting needs a Redshift connection.');
        return;
      }
      const choice = await vscode.window.showQuickPick(
        [
          { label: 'Reconstruct current grants', detail: `GRANT statements that recreate ${objectLabel(ref)}'s current privileges`, action: 'reconstruct' as const },
          { label: 'Build a GRANT…', detail: 'Pick privileges and a grantee', action: 'grant' as const },
          { label: 'Build a REVOKE…', detail: 'Pick privileges and a grantee', action: 'revoke' as const },
        ],
        { title: `Script grants — ${objectLabel(ref)}`, placeHolder: 'Generated SQL opens for review; nothing runs.' },
      );
      if (choice === undefined) return;
      if (choice.action === 'reconstruct') {
        try {
          const priv = await governance.objectPrivileges(ref);
          await openSql(generateGrantScript(ref, priv.grants));
        } catch (err) {
          void vscode.window.showWarningMessage(`RedLens: could not read privileges — ${msg(err)}`);
        }
        return;
      }
      const grant = await promptGrant(ref);
      if (grant === undefined) return;
      await openSql(choice.action === 'grant' ? generateGrant(ref, grant) : generateRevoke(ref, grant));
    }),

    // --- b3: user / role / datashare admin (code-gen for review) ---

  );
}

const TABLE_PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REFERENCES', 'DROP'];
const SCHEMA_PRIVS = ['USAGE', 'CREATE'];

async function promptGrant(ref: ObjectRef): Promise<PrivilegeGrant | undefined> {
  const picks = await vscode.window.showQuickPick(
    (ref.kind === 'schema' ? SCHEMA_PRIVS : TABLE_PRIVS).map((p) => ({ label: p })),
    { canPickMany: true, title: `Privileges on ${objectLabel(ref)}`, placeHolder: 'Pick one or more' },
  );
  if (picks === undefined || picks.length === 0) return undefined;
  const type = await vscode.window.showQuickPick(
    [
      { label: 'Role (RBAC)', value: 'role' as GranteeType },
      { label: 'User', value: 'user' as GranteeType },
      { label: 'Group', value: 'group' as GranteeType },
      { label: 'PUBLIC', value: 'public' as GranteeType },
    ],
    { title: 'Grantee type' },
  );
  if (type === undefined) return undefined;
  let grantee = 'PUBLIC';
  if (type.value !== 'public') {
    const input = await vscode.window.showInputBox({
      title: `${type.label} name`,
      prompt: `Name of the ${type.label.toLowerCase()} to grant to`,
      validateInput: (v) => (v.trim() === '' ? 'Enter a name' : undefined),
    });
    if (input === undefined || input.trim() === '') return undefined;
    grantee = input.trim();
  }
  // One GRANT/REVOKE statement covers multiple privileges — join with commas is
  // not what generateGrant does (single priv), so emit the first; the reconstruct
  // path handles multi-row. To keep it one call, fold the privileges here.
  return { grantee, granteeType: type.value, privilege: picks.map((p) => p.label).join(', '), withGrantOption: false };
}

/** A programmatic {ref, user} arg (from shots or other code) vs a tree node. */
function asDirectArg(node: unknown): { ref: ObjectRef; user: string } | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const n = node as { ref?: ObjectRef; user?: unknown };
  if (n.ref && typeof n.ref === 'object' && typeof n.user === 'string') {
    return { ref: n.ref, user: n.user };
  }
  return undefined;
}

function nodeToRef(node: unknown): ObjectRef | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const n = node as { type?: string; table?: { schema: string; name: string }; schema?: string };
  if (n.type === 'table' && n.table) return { kind: 'table', schema: n.table.schema, name: n.table.name };
  if (n.type === 'schema' && typeof n.schema === 'string') return { kind: 'schema', schema: n.schema };
  return undefined;
}

async function openSql(content: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: content.endsWith('\n') ? content : content + '\n' });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function requireRedshift(governance: GovernanceService): boolean {
  if (governance.supported()) return true;
  void vscode.window.showInformationMessage('RedLens: this needs a Redshift connection.');
  return false;
}

