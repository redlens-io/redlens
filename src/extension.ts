import * as vscode from 'vscode';
import { gatedCommand, installLicenseGate } from './licensing/gate';
import { ProState } from './licensing/proState';
import { ContributionRegistry } from './api/contributions';
import { createRedLensExports } from './api/redLensApi';
import { registerProUpsell } from './commands/proUpsell';
import type { RedLensExports } from './api/contract';
import { ConnectionStore } from './connections/connectionStore';
import { ConnectionManager } from './connections/connectionManager';
import { GlobalStateHostKeyStore } from './transport/hostKeyStore';
import { MetadataService } from './metadata/metadataService';
import { GovernanceService } from './redshift/governanceService';
import { ExplorerProvider } from './explorer/explorerProvider';
import { ToolsProvider } from './tools/toolsProvider';
import { ClusterService } from './aws/clusterService';
import { ClusterProvider } from './cluster/clusterProvider';
import { registerClusterCommands } from './commands/cluster';
import { registerGovernanceCommands } from './commands/governance';
import { registerCompletionProvider } from './language/completionProvider';
import { registerFormatProvider } from './language/formatProvider';
import { registerHoverProvider } from './language/hoverProvider';
import { registerLinter } from './language/lintProvider';
import { registerCommands } from './commands';
import { registerAdvancedCommands } from './commands/advanced';
import { registerMcp } from './mcp/provider';
import { registerNotebook } from './notebook/notebookProvider';
import { registerSchemaTools } from './commands/schemaTools';
import { registerBuilderTools } from './commands/builderTools';
import { createStatusBar } from './ui/statusBar';

let output: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): RedLensExports {
  output = vscode.window.createOutputChannel('RedLens');
  context.subscriptions.push(output);
  const version = (context.extension.packageJSON as { version: string }).version;
  output.appendLine(`RedLens activated (v${version})`);

  // What the base knows about Pro: whether a feature is usable, so the padlocks
  // and the upsell can be honest. Nothing about licences — that authority is
  // registered from outside, through the bridge.
  const pro = new ProState();
  context.subscriptions.push(pro);
  const contributions = new ContributionRegistry();
  context.subscriptions.push(contributions);

  // The gate is a module singleton every command registration reads at invoke
  // time, so it must be installed before anything can be run. It now asks
  // ProState rather than a licence service: verification moved to the Pro
  // package, and this extension no longer contains any of it.
  installLicenseGate(pro);
  registerProUpsell(context, pro);

  const store = new ConnectionStore(context.secrets);
  // Bastion host keys are public data that must survive and stay inspectable,
  // so globalState rather than SecretStorage (S-07).
  const hostKeys = new GlobalStateHostKeyStore(context.globalState);
  const manager = new ConnectionManager(store, output, hostKeys);
  context.subscriptions.push(manager);

  const metadata = new MetadataService(manager);
  context.subscriptions.push(metadata);
  const governance = new GovernanceService(manager);
  context.subscriptions.push(governance);
  const explorer = new ExplorerProvider(manager, metadata, governance, pro);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('redlensExplorer', explorer));
  // The Tools view (M9b4): the catalog of what RedLens does, grouped by intent.
  const tools = new ToolsProvider(manager, pro);
  context.subscriptions.push(tools);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('redlensTools', tools));
  // The Cluster view (M10b2): the Redshift console's configuration, read-only.
  const cluster = new ClusterService(manager);
  context.subscriptions.push(cluster);
  const clusterTree = new ClusterProvider(cluster, pro, contributions);
  context.subscriptions.push(clusterTree);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('redlensCluster', clusterTree));
  context.subscriptions.push(registerCompletionProvider(metadata));
  context.subscriptions.push(registerFormatProvider());
  context.subscriptions.push(registerHoverProvider(metadata));
  registerLinter(context);

  // Drives the viewsWelcome empty state and command `enablement` (M9b1). Synced
  // eagerly as well as on change: before the first connection the contexts were
  // simply never set, so a when-clause saw `undefined` instead of `false` — same
  // truthiness, but nothing to inspect when a command is unexpectedly grey.
  const syncContext = (): void => {
    const active = manager.getActive();
    void vscode.commands.executeCommand('setContext', 'redlens.connected', active !== undefined);
    void vscode.commands.executeCommand('setContext', 'redlens.inTransaction', active?.inTransaction === true);
  };
  syncContext();
  context.subscriptions.push(manager.onDidChangeActive(() => syncContext()));

  registerCommands(context, store, manager, explorer, metadata, hostKeys);
  registerAdvancedCommands(context, manager);
  registerClusterCommands(context, cluster, pro);
  registerNotebook(context, manager);
  registerSchemaTools(context, manager, metadata);
  registerBuilderTools(context, manager, metadata);
  registerGovernanceCommands(context, governance, manager);
  context.subscriptions.push(createStatusBar(manager));

  // Refusing a changed host key is only safe if there is a deliberate way back:
  // a legitimately rebuilt bastion would otherwise be unreachable forever, and
  // the workaround people find in that situation is to disable the check.
  context.subscriptions.push(
    gatedCommand('redlens.manageHostKeys', async () => {
      const known = hostKeys.known();
      if (known.length === 0) {
        void vscode.window.showInformationMessage('RedLens: no SSH bastion host keys are remembered yet.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        known.map((k) => ({ label: k.hostId, description: `SHA256:${k.fingerprint}`, hostId: k.hostId })),
        { title: 'Remembered SSH bastion host keys', placeHolder: 'Pick one to forget' },
      );
      if (pick === undefined) return;
      const forget = 'Forget key';
      const answer = await vscode.window.showWarningMessage(
        `Forget the host key for ${pick.hostId}?`,
        {
          modal: true,
          detail:
            'The next connection will ask you to confirm a fingerprint again. Only do this if you know ' +
            'why the key changed — a rebuilt bastion is the usual reason, but an unexpected change can ' +
            'also mean the connection is being intercepted.',
        },
        forget,
      );
      if (answer === forget) {
        await hostKeys.forget(pick.hostId);
        void vscode.window.showInformationMessage(`RedLens: forgot the host key for ${pick.hostId}.`);
      }
    }),
  );

  context.subscriptions.push(
    gatedCommand('redlens.showWelcome', () => {
      void vscode.window.showInformationMessage(
        `RedLens v${version} — connect to a database with "RedLens: Add Connection", open a .sql file and press Ctrl+Enter.`,
      );
    }),
  );

  if (output !== undefined) {
    registerMcp(context, store, manager, metadata, output);
  }

  return createRedLensExports({
    manager, metadata, governance, cluster, contributions, pro,
    output, baseVersion: version,
  });
}

export function deactivate(): void {
  output = undefined;
}
