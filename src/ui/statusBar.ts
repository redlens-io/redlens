import * as vscode from 'vscode';
import type { ActiveConnection, ConnectionManager } from '../connections/connectionManager';

/** Always-visible entry point: shows connection state + flags, click opens the
 * toggle menu (redlens.statusBarMenu). */
export function createStatusBar(manager: ConnectionManager): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  item.command = 'redlens.statusBarMenu';
  const update = (): void => render(item, manager.getActive(), manager.isQueryRunning());
  update();
  item.show();

  const sub = manager.onDidChangeActive(() => update());
  // Re-render when pii-safe mode is toggled so the indicator stays in sync (UXD-015).
  const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('redlens.piiSafeMode')) { update(); }
  });
  return vscode.Disposable.from(item, sub, cfgSub);
}

function render(item: vscode.StatusBarItem, active: ActiveConnection | undefined, running: boolean): void {
  // Reset every render so a prior production/txn warning background never lingers
  // onto the disconnected or running state (UXD-041).
  item.backgroundColor = undefined;
  const piiOn = vscode.workspace.getConfiguration('redlens').get<boolean>('piiSafeMode', false);

  if (active === undefined) {
    item.text = '$(plug) RedLens: Connect';
    item.tooltip = 'No active connection — click to connect';
  } else if (running) {
    item.text = `$(sync~spin) RedLens: ${active.profile.name}`;
    item.tooltip = 'Query running — click for actions (Cancel Running Query)';
  } else {
    const flags = [
      active.readOnly ? '$(lock)' : '',
      active.production ? '$(alert)' : '',
      active.inTransaction ? '$(git-commit) TXN' : active.autoCommit ? '' : '$(git-commit)',
      piiOn ? '$(eye-closed)' : '',
    ].filter(Boolean).join(' ');
    item.text = `$(database) RedLens: ${active.profile.name} ${flags}`.trimEnd();
    item.tooltip = `Connected to ${active.profile.host}:${active.profile.port}/${active.profile.database}` +
      `${active.readOnly ? ' · READ-ONLY' : ''}${active.production ? ' · PRODUCTION' : ''}` +
      `${active.inTransaction ? ' · OPEN TRANSACTION' : active.autoCommit ? '' : ' · manual commit'}` +
      `${piiOn ? ' · PII-safe' : ''}` +
      ' — click for toggles';
    item.backgroundColor = active.production || active.inTransaction
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
  }
}
