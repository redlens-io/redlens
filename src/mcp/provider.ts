import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { BridgeServer } from './bridgeCore';
import { ExtensionBridgeBackend } from './extensionBackend';
import { readPiiConfig } from '../pii/piiSettings';
import type { ConnectionManager } from '../connections/connectionManager';
import type { ConnectionStore } from '../connections/connectionStore';
import type { MetadataService } from '../metadata/metadataService';

/**
 * Registers the embedded MCP server (PLAN §5.4): VS Code launches
 * dist/mcp-server.js as a stdio child using VS Code's OWN Node runtime
 * (ELECTRON_RUN_AS_NODE) — works on machines with no system Node, which is
 * also this project's toolchain policy. Credentials stay in the extension;
 * the child only gets a localhost bridge port.
 */
export function registerMcp(
  context: vscode.ExtensionContext,
  store: ConnectionStore,
  manager: ConnectionManager,
  metadata: MetadataService,
  output: vscode.OutputChannel,
): void {
  // One secret per extension session, never persisted: it only has to outlive
  // the child process it authenticates (S-09).
  const token = randomBytes(32).toString('hex');
  const bridge = new BridgeServer(new ExtensionBridgeBackend(store, manager, metadata, readPiiConfig), token);
  context.subscriptions.push({ dispose: () => void bridge.stop() });

  const changeEmitter = new vscode.EventEmitter<void>();
  context.subscriptions.push(
    changeEmitter,
    vscode.lm.registerMcpServerDefinitionProvider('redlens.mcpProvider', {
      onDidChangeMcpServerDefinitions: changeEmitter.event,
      provideMcpServerDefinitions: async () => {
        const port = await bridge.start();
        output.appendLine(`MCP bridge listening on 127.0.0.1:${port}`);
        return [
          new vscode.McpStdioServerDefinition(
            'RedLens Redshift',
            process.execPath,
            [context.asAbsolutePath('dist/mcp-server.js')],
            {
              ELECTRON_RUN_AS_NODE: '1',
              REDLENS_BRIDGE_PORT: String(port),
              REDLENS_BRIDGE_TOKEN: token,
            },
            (context.extension.packageJSON as { version: string }).version,
          ),
        ];
      },
      resolveMcpServerDefinition: async (server) => {
        await bridge.start();
        return server;
      },
    }),
  );
  output.appendLine('MCP server definition provider registered (RedLens Redshift).');
}
