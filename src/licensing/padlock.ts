/**
 * Where a padlocked entry sends the user (Fase O). Pure, so the rule can be
 * enforced by a test rather than by remembering it in each tree provider.
 *
 * The rule exists because of what the split changes underneath the UI. Before
 * it, every command was registered by this extension and a locked entry could
 * safely point at its own command — the gate intercepted the call. Afterwards,
 * a Pro command belongs to an extension the user may never have installed, so
 * the same click reaches VS Code's "command 'redlens.showDashboard' not found":
 * an error message where the user was owed an offer.
 *
 * Both mixed-tier surfaces — the Tools view and the Cluster view — route
 * through here, so neither can drift into pointing at a command that might not
 * exist.
 */

export const UPSELL_COMMAND = 'redlens.proUpsell';

export interface EntryCommand {
  command: string;
  title: string;
  arguments?: unknown[];
}

/**
 * The command a tree entry should invoke.
 *
 * `featureId` is what the upsell needs in order to name the specific feature —
 * vague copy ("upgrade to continue") converts nobody — and for a command-backed
 * entry it is simply the command id.
 */
export function entryCommand(args: {
  featureId: string;
  title: string;
  locked: boolean;
  /** The real command, when the entry has one. Cluster sections do not. */
  command?: string;
}): EntryCommand {
  if (args.locked || args.command === undefined) {
    return { command: UPSELL_COMMAND, title: args.title, arguments: [args.featureId] };
  }
  return { command: args.command, title: args.title };
}
