import * as vscode from 'vscode';
import { PRICING_URL, PRO_EXTENSION_ID, PRO_MARKETPLACE_URL, PURCHASE_URL } from '../branding';
import { pitchFor } from '../licensing/tiers';
import type { ProState } from '../licensing/proState';

/**
 * The offer behind a padlock (Fase O).
 *
 * Before the split, a padlocked entry in the Tools view pointed at its own
 * command and the gate intercepted the call. After the split that command
 * belongs to an extension the user may not have installed, so the same click
 * would reach VS Code's "command 'redlens.showDashboard' not found" — an error
 * message, where the user deserved an explanation and a way forward. This
 * command is what the padlocks point at instead.
 *
 * It also has to answer two genuinely different situations with the same
 * click, which is why it is not just a link:
 *   - Pro is not installed → offer to install it.
 *   - Pro is installed but this feature is not unlocked (no licence, expired
 *     trial) → hand off to Pro's own licence UI, which owns that conversation.
 *
 * The copy lives here, in the open extension, on purpose: how RedLens sells
 * itself is part of what someone reading the public repo is entitled to see.
 */
export function registerProUpsell(context: vscode.ExtensionContext, pro: ProState): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('redlens.proUpsell', async (featureId?: string) => {
      const pitch = featureId === undefined ? GENERIC_PITCH : pitchFor(featureId);

      if (!pro.installed) {
        const install = 'Install RedLens Pro';
        // "Buy a licence" sits above "What is in Pro?" on purpose (1.0.2).
        // Until 1.0.2 neither button ended anywhere a payment could happen:
        // both roads led to the pricing page, which described buying a key and
        // linked to nothing that sells one. Someone who has already decided —
        // told to buy it, or back for a second machine — should not have to
        // install and hunt first.
        const buy = 'Buy a licence';
        const whatsIn = 'What is in Pro?';
        const choice = await vscode.window.showInformationMessage(
          `RedLens Pro: ${pitch} The 14-day trial covers all of it — no card, no account.`,
          install,
          buy,
          whatsIn,
        );
        if (choice === install) {
          // Opens the Extensions view on Pro rather than a browser: it is the
          // one path that ends in an installed extension instead of a tab.
          await vscode.commands.executeCommand('workbench.extensions.search', `@id:${PRO_EXTENSION_ID}`)
            .then(undefined, async () => {
              await vscode.env.openExternal(vscode.Uri.parse(PRO_MARKETPLACE_URL));
            });
        } else if (choice === buy) {
          await vscode.env.openExternal(vscode.Uri.parse(PURCHASE_URL));
        } else if (choice === whatsIn) {
          await vscode.env.openExternal(vscode.Uri.parse(PRICING_URL));
        }
        return;
      }

      // Pro is here; it owns everything about licence state, so defer to it
      // rather than guessing at a reason the base cannot actually know.
      await vscode.commands.executeCommand('redlens.manageLicense');
    }),
  );
}

const GENERIC_PITCH =
  'the warehouse-specific half of RedLens — cost and performance advice, the console, the AI and governance admin.';
