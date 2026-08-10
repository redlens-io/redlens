import * as vscode from 'vscode';
import { createConnection } from '../transport/factory';
import type { HostKeyStore } from '../transport/sshTunnel';
import type { BufferedTransport } from '../transport/types';
import type { ConnectionProfile } from './profile';
import type { ConnectionStore } from './connectionStore';
import type { MetadataSource } from '../metadata/types';

export interface ActiveConnection {
  profile: ConnectionProfile;
  transport: BufferedTransport;
  /** Set by non-SQL transports (demo fixtures); SQL connections derive one. */
  metadataSource?: MetadataSource;
  /** Torn down on disconnect (e.g. SSH tunnel). */
  cleanup?: () => Promise<void>;
  /** Session write-safety flags (read-only-toggle / prod-safeguard). */
  readOnly: boolean;
  production: boolean;
  /** transaction-control: false = manual commit (queries run inside a txn). */
  autoCommit: boolean;
  /** transaction-control: an explicit transaction is currently open. */
  inTransaction: boolean;
}

/**
 * Owns the (single, in A1) active connection and emits changes for the UI.
 * Multi-connection + per-document mapping arrives with the explorer (A2).
 */
export class ConnectionManager implements vscode.Disposable {
  private active: ActiveConnection | undefined;
  private runningExecution: { id: string } | undefined;
  /** Last failed query on this connection (for smart-error-fix). */
  private lastFailure: { sql: string; error: string } | undefined;

  private readonly changeEmitter = new vscode.EventEmitter<ActiveConnection | undefined>();
  readonly onDidChangeActive = this.changeEmitter.event;

  constructor(
    private readonly store: ConnectionStore,
    private readonly output: vscode.OutputChannel,
    /** Bastion host keys (S-07); SSH profiles refuse to connect without it. */
    private readonly hostKeys?: HostKeyStore,
  ) {}

  getActive(): ActiveConnection | undefined {
    return this.active;
  }

  /** Flip a write-safety flag on the active connection and notify listeners. */
  setFlag(flag: 'readOnly' | 'production' | 'autoCommit', value: boolean): void {
    if (this.active !== undefined) {
      this.active[flag] = value;
      this.changeEmitter.fire(this.active);
    }
  }

  /** transaction-control: open a transaction before a query in manual-commit
   * mode (no-op for the demo transport, which has no real session). */
  async beginIfManual(): Promise<void> {
    const active = this.active;
    if (active === undefined || active.autoCommit || active.inTransaction || active.profile.kind === 'demo') {
      return;
    }
    await this.runControl('BEGIN');
    active.inTransaction = true;
    this.changeEmitter.fire(active);
  }

  /** transaction-control: end the open transaction. Returns false if none. */
  async endTransaction(action: 'COMMIT' | 'ROLLBACK'): Promise<boolean> {
    const active = this.active;
    if (active === undefined || !active.inTransaction) {
      return false;
    }
    await this.runControl(action);
    active.inTransaction = false;
    this.changeEmitter.fire(active);
    return true;
  }

  private async runControl(sql: string): Promise<void> {
    const active = this.requireActive();
    const id = await active.transport.execute(sql);
    active.transport.releaseResult(id);
  }

  isQueryRunning(): boolean {
    return this.runningExecution !== undefined;
  }

  /** smart-error-fix: remember the last failed statement + error message. */
  recordFailure(sql: string, error: string): void {
    this.lastFailure = { sql, error };
  }

  getLastFailure(): { sql: string; error: string } | undefined {
    return this.lastFailure;
  }

  async connect(profile: ConnectionProfile, password: string): Promise<void> {
    await this.disconnect();
    this.output.appendLine(`Connecting to ${profile.name} (${profile.kind})…`);
    const created = await createConnection(profile, password, this.hostKeys);
    try {
      await created.transport.connect();
    } catch (err) {
      await created.cleanup?.();
      throw err;
    }
    this.active = {
      profile,
      transport: created.transport,
      metadataSource: created.metadataSource,
      cleanup: created.cleanup,
      readOnly: false,
      production: false,
      autoCommit: true,
      inTransaction: false,
    };
    this.output.appendLine(`Connected: ${profile.name}`);
    this.changeEmitter.fire(this.active);
  }

  async disconnect(): Promise<void> {
    if (this.active !== undefined) {
      const name = this.active.profile.name;
      await this.active.transport.dispose();
      await this.active.cleanup?.();
      this.active = undefined;
      this.runningExecution = undefined;
      this.lastFailure = undefined;
      this.output.appendLine(`Disconnected: ${name}`);
      this.changeEmitter.fire(undefined);
    }
  }

  async execute(sql: string): Promise<string> {
    const active = this.requireActive();
    this.runningExecution = { id: 'pending' };
    this.changeEmitter.fire(active);
    try {
      const id = await active.transport.execute(sql);
      return id;
    } catch (err) {
      // A failed statement inside an explicit transaction is auto-rolled-back
      // by the transport (recovery ROLLBACK), so the transaction is gone —
      // keep our manual-commit flag in sync (transaction-control).
      if (active.inTransaction) {
        active.inTransaction = false;
      }
      throw err;
    } finally {
      this.runningExecution = undefined;
      this.changeEmitter.fire(active);
    }
  }

  async cancelRunning(): Promise<void> {
    const active = this.requireActive();
    await active.transport.cancel('current');
  }

  async passwordFor(profile: ConnectionProfile): Promise<string | undefined> {
    return this.store.getPassword(profile.id);
  }

  private requireActive(): ActiveConnection {
    if (this.active === undefined) {
      throw new Error('No active connection');
    }
    return this.active;
  }

  dispose(): void {
    void this.disconnect();
    this.changeEmitter.dispose();
  }
}
