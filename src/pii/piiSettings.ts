import * as vscode from 'vscode';
import type { PiiConfig } from './piiMask';

/** Current pii-safe-mode config from VS Code settings. */
export function readPiiConfig(): PiiConfig {
  const cfg = vscode.workspace.getConfiguration('redlens');
  return {
    enabled: cfg.get<boolean>('piiSafeMode', false),
    patterns: cfg.get<string[]>('piiColumns', []),
  };
}
