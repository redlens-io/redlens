import * as vscode from 'vscode';
import { requiresPro } from './tiers';
import type { LicenseProvider } from '../api/contract';

/**
 * What the base knows about RedLens Pro (Fase O).
 *
 * The base does not verify licences — that whole apparatus (Ed25519, the
 * entitlement, the trial clock) lives in the Pro extension and is closed. What
 * the base needs is narrower and entirely presentational: *is this feature
 * usable right now*, so the Tools view can draw a padlock and the upsell can
 * name the right thing.
 *
 * Pro registers itself through the bridge (`licensing.setProvider`). Until it
 * does — because it is not installed, is disabled, or the user never bought it —
 * there is simply no provider, and every Pro feature reads as locked. That is
 * the correct default and it needs no special case.
 *
 * Note the asymmetry with the pre-split code: the old `gatedCommand` wrapper is
 * gone from the base entirely. Every command the base registers is Free by
 * construction, so there is nothing left for a gate to decide here.
 */
export class ProState implements vscode.Disposable {
  private provider: LicenseProvider | undefined;
  private providerSub: vscode.Disposable | undefined;

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires when Pro appears, disappears, or its entitlement changes. */
  readonly onDidChange = this.changeEmitter.event;

  /** Whether RedLens Pro is present and talking to us at all. */
  get installed(): boolean {
    return this.provider !== undefined;
  }

  setProvider(provider: LicenseProvider): vscode.Disposable {
    this.provider = provider;
    this.providerSub?.dispose();
    this.providerSub = provider.onDidChange(() => this.changeEmitter.fire());
    this.changeEmitter.fire();
    return new vscode.Disposable(() => {
      if (this.provider === provider) {
        this.provider = undefined;
        this.providerSub?.dispose();
        this.providerSub = undefined;
        this.changeEmitter.fire();
      }
    });
  }

  /**
   * Whether a feature is locked right now — the padlocks in the Tools view.
   *
   * Free features are never locked, whatever Pro says. The base is the
   * authority on its own tier, so a bug or a hostile build of Pro cannot lock
   * a user out of something they were promised for free.
   */
  isLocked(featureId: string): boolean {
    if (!requiresPro(featureId)) {
      return false;
    }
    return this.provider === undefined || !this.provider.isUnlocked(featureId);
  }

  dispose(): void {
    this.providerSub?.dispose();
    this.changeEmitter.dispose();
  }
}
