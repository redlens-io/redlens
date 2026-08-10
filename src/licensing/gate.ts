import * as vscode from 'vscode';
import { entryCommand } from './padlock';
import type { ProState } from './proState';

/**
 * The command gate — kept during the Fase O split, then deleted.
 *
 * This wrapper exists because the base still *registers* Pro commands that have
 * not moved to the Pro package yet. Once they all have, every command this
 * extension declares is Free by construction, there is nothing left for a gate
 * to decide, and this file goes away with the last of them (see
 * `cluster/ownedSections.ts` for the same idea applied to the Cluster view).
 *
 * What changed already: the gate no longer knows anything about licences. It
 * asks `ProState`, which asks whichever provider Pro registered through the
 * bridge, and when there is no provider every Pro feature is locked. So the
 * open extension carries no verification logic even while it still carries some
 * paid features.
 *
 * It still fails open before a ProState is installed — as in the integration
 * tests, which never activate licensing — because a wiring mistake should let
 * the product work, not lock it.
 */
let state: ProState | undefined;

export function installLicenseGate(proState: ProState): void {
  state = proState;
}

/** Test seam: forget the installed state. */
export function resetLicenseGate(): void {
  state = undefined;
}

export function gatedCommand(
  id: string,
  handler: (...args: never[]) => unknown,
): vscode.Disposable {
  return vscode.commands.registerCommand(id, (...args: never[]) => {
    if (state !== undefined && state.isLocked(id)) {
      // One voice for the paywall: the same offer the padlock in the Tools view
      // leads to, rather than a second dialog with its own wording.
      void vscode.commands.executeCommand(entryCommand({
        featureId: id, title: id, locked: true,
      }).command, id);
      return undefined;
    }
    return handler(...args);
  });
}
