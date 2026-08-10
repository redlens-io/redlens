import * as vscode from 'vscode';
import { sanitizeEvent, type TelemetryEventName } from './events';

/**
 * Telemetry emission (S6). Two rules from the official guidance, both enforced
 * here rather than trusted to callers:
 *
 *  - Everything goes through `env.createTelemetryLogger`, never straight to a
 *    sender. The logger honours the user's `telemetry.telemetryLevel` and scrubs
 *    data on its way out.
 *  - The user's global preference always wins. Our own setting can only turn
 *    telemetry further OFF, never back on.
 *
 * With no sender configured this is a no-op, which is the current shipping
 * state: the emitter and its guarantees exist and are tested, and pointing it at
 * a backend is a one-line change once there is an Application Insights resource.
 */
export class Telemetry implements vscode.Disposable {
  private readonly logger: vscode.TelemetryLogger | undefined;

  constructor(
    private readonly knownCommandIds: ReadonlySet<string>,
    sender?: vscode.TelemetrySender,
  ) {
    this.logger = sender === undefined ? undefined : vscode.env.createTelemetryLogger(sender);
  }

  /** True only when BOTH the global preference and our own setting allow it. */
  private allowed(): boolean {
    if (!vscode.env.isTelemetryEnabled) {
      return false;
    }
    return vscode.workspace.getConfiguration('redlens').get<boolean>('telemetry.enabled', true);
  }

  send(name: TelemetryEventName, properties?: Record<string, unknown>): void {
    if (this.logger === undefined || !this.allowed()) {
      return;
    }
    const event = sanitizeEvent(name, properties, this.knownCommandIds);
    if (event === undefined) {
      return; // never send a payload that did not pass the allowlist
    }
    this.logger.logUsage(event.name, event.properties);
  }

  dispose(): void {
    this.logger?.dispose();
  }
}

/** Command ids declared by the extension — the only values `command` may carry. */
export function declaredCommandIds(packageJson: unknown): ReadonlySet<string> {
  const commands = (packageJson as { contributes?: { commands?: { command?: string }[] } })
    ?.contributes?.commands;
  return new Set((commands ?? []).map((c) => c.command).filter((c): c is string => typeof c === 'string'));
}
