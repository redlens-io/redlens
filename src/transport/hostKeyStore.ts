import * as vscode from 'vscode';
import type { HostKeyStore } from './sshTunnel';

const KEY = 'redlens.knownHostKeys';

/**
 * Trust-on-first-use store for SSH bastion host keys (S-07), backed by the
 * extension's globalState — the same model as OpenSSH's known_hosts.
 *
 * Fingerprints are not secrets (they are public keys), so globalState is the
 * right home rather than SecretStorage: they must survive, be inspectable, and
 * be removable by the user when a bastion is legitimately rebuilt.
 */
export class GlobalStateHostKeyStore implements HostKeyStore {
  constructor(private readonly memento: vscode.Memento) {}

  private all(): Record<string, string> {
    return this.memento.get<Record<string, string>>(KEY, {});
  }

  get(hostId: string): string | undefined {
    return this.all()[hostId];
  }

  async remember(hostId: string, fingerprint: string): Promise<void> {
    await this.memento.update(KEY, { ...this.all(), [hostId]: fingerprint });
  }

  async forget(hostId: string): Promise<void> {
    const next = { ...this.all() };
    delete next[hostId];
    await this.memento.update(KEY, next);
  }

  known(): { hostId: string; fingerprint: string }[] {
    return Object.entries(this.all()).map(([hostId, fingerprint]) => ({ hostId, fingerprint }));
  }

  async confirmUnknown(hostId: string, fingerprint: string): Promise<boolean> {
    // Modal on purpose: this is the one moment where the user is the only thing
    // standing between a first connection and a machine-in-the-middle, and the
    // fingerprint has to be compared against something they obtained elsewhere.
    const trust = 'Trust and continue';
    const answer = await vscode.window.showWarningMessage(
      `First connection to the SSH bastion ${hostId}.`,
      {
        modal: true,
        detail:
          `Host key fingerprint:\n  SHA256:${fingerprint}\n\n` +
          'Confirm this matches the fingerprint you obtained from the bastion itself ' +
          '(for example `ssh-keyscan` run from a trusted network, or your infrastructure ' +
          'documentation). If it does not match, someone may be intercepting the connection — ' +
          'the bastion password and every query would go through them.',
      },
      trust,
    );
    return answer === trust;
  }
}
