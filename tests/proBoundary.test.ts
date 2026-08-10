import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { UPSELL_COMMAND, entryCommand } from '../src/licensing/padlock';
import { FEATURE_TIERS, clusterSectionFeature, requiresPro, tierOf } from '../src/licensing/tiers';
import { BASE_RENDERED_SECTIONS, SPLIT_IN_FLIGHT } from '../src/cluster/ownedSections';
import { CLUSTER_SECTIONS } from '../src/aws/clusterInfo';
import { allTools } from '../src/tools/catalog';

/**
 * Guards for the open-core boundary (Fase O).
 *
 * The split moves the paid features into a second extension the user may never
 * install. Everything here defends the seam that creates — a padlock the user
 * clicks has to reach an offer, not a missing command — and none of it can be
 * checked by reading the code, because the failure only shows up on a machine
 * where Pro is absent.
 */

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  contributes: { commands: { command: string; title: string }[] };
};
const declared = new Set(pkg.contributes.commands.map((c) => c.command));

describe('a padlock always leads somewhere', () => {
  it('sends every locked Pro tool to the upsell, never to its own command', () => {
    const proTools = allTools().filter((t) => requiresPro(t.command));
    expect(proTools.length, 'no Pro tools in the catalog — the tier map or the catalog is wrong').toBeGreaterThan(0);

    for (const tool of proTools) {
      const locked = entryCommand({
        featureId: tool.command, title: tool.label, locked: true, command: tool.command,
      });
      expect(locked.command, `${tool.command} locked`).toBe(UPSELL_COMMAND);
      // The upsell names the feature; vague copy converts nobody, and it is
      // also how it decides between "install Pro" and "your licence lapsed".
      expect(locked.arguments, `${tool.command} locked`).toEqual([tool.command]);
    }
  });

  it('sends unlocked tools straight to the real command', () => {
    for (const tool of allTools()) {
      const open = entryCommand({
        featureId: tool.command, title: tool.label, locked: false, command: tool.command,
      });
      expect(open.command, tool.command).toBe(tool.command);
    }
  });

  it('sends locked Cluster sections to the upsell with their section feature id', () => {
    const proSections = CLUSTER_SECTIONS.filter((s) => requiresPro(clusterSectionFeature(s.id)));
    expect(proSections.length, 'the Cluster view has no Pro sections — tiers.ts changed').toBeGreaterThan(0);

    for (const section of proSections) {
      const feature = clusterSectionFeature(section.id);
      const locked = entryCommand({ featureId: feature, title: section.title, locked: true });
      expect(locked.command, `cluster:${section.id}`).toBe(UPSELL_COMMAND);
      expect(locked.arguments, `cluster:${section.id}`).toEqual([feature]);
    }
  });

  it('declares the upsell command, and keeps it Free', () => {
    // Gating the way out of a paywall behind the paywall is the kind of bug
    // that only ever reproduces for someone who is not paying.
    expect(declared.has(UPSELL_COMMAND)).toBe(true);
    expect(tierOf(UPSELL_COMMAND)).toBe('free');
  });
});

describe('what the base can render', () => {
  it('lists only real sections', () => {
    const known = new Set(CLUSTER_SECTIONS.map((s) => s.id));
    const stale = BASE_RENDERED_SECTIONS.filter((id) => !known.has(id));
    expect(stale, `sections that no longer exist: ${stale.join(', ')}`).toEqual([]);
  });

  it('keeps the Free sections renderable, whatever else moves', () => {
    // Properties is Free by an explicit decision (M10 §3). If the split ever
    // takes it to Pro, a Free user opens the Cluster view and finds ten
    // padlocks — which is exactly the outcome the tier was chosen to avoid.
    const freeSections = CLUSTER_SECTIONS
      .filter((s) => !requiresPro(clusterSectionFeature(s.id)))
      .map((s) => s.id);
    expect(freeSections.length).toBeGreaterThan(0);
    for (const id of freeSections) {
      expect(BASE_RENDERED_SECTIONS, `free section ${id} must be renderable by the base`).toContain(id);
    }
  });

  it('renders nothing Pro once the split lands', () => {
    const paid = BASE_RENDERED_SECTIONS.filter((id) => requiresPro(clusterSectionFeature(id)));
    if (SPLIT_IN_FLIGHT) {
      // The Pro renderers still live in this package, so this is expected. The
      // assertion is inverted on purpose: when the move happens and this list
      // empties, SPLIT_IN_FLIGHT has to be flipped or the suite says so. A flag
      // nobody is forced to clear is a flag that stays set forever.
      expect(paid.length, 'the split is done — set SPLIT_IN_FLIGHT to false').toBeGreaterThan(0);
      return;
    }
    expect(paid, `Pro sections still rendered by the base: ${paid.join(', ')}`).toEqual([]);
  });
});

describe('the tier map survives the split', () => {
  it('still classifies every declared command', () => {
    const unclassified = [...declared].filter((id) => FEATURE_TIERS[id] === undefined);
    expect(unclassified, `commands with no tier: ${unclassified.join(', ')}`).toEqual([]);
  });
});
