import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOOL_GROUPS, allTools } from '../src/tools/catalog';
import { requiresPro } from '../src/licensing/tiers';

/**
 * Keeps the Tools view honest (M9b4). The catalog is hand-written prose — it
 * would rot the moment a batch adds a command and forgets the view.
 *
 * Since M9b6 the palette is a shortcut rather than a catalog (18 keyboard verbs),
 * so the invariant is no longer "catalog == palette-visible". It is now the
 * sharper one: the Tools view lists every GLOBAL utility. A command is out of it
 * only because it belongs to something you clicked — an object in the tree, or
 * the open result grid — or because it is dispatched internally.
 *
 * The Fase O split adds a wrinkle that looks like rot but is the design: the
 * catalog advertises Pro utilities this extension does not declare, because the
 * Pro extension declares them. That is deliberate — padlocks have to render
 * without Pro installed, since nobody buys what they cannot see (M10b5). So the
 * checks below compare against "declared here" for Free entries and relax to
 * "classified as Pro" for the rest.
 */

interface Cmd { command: string; title: string }
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  contributes: { commands: Cmd[]; menus: Record<string, { command?: string; when?: string }[]> };
};
const declared = pkg.contributes.commands.map((c) => c.command);

/** Not global: each of these needs a subject the Tools view cannot supply. */
const NOT_IN_TOOLS = new Set([
  // act on the tree node you right-clicked
  'redlens.previewTable', 'redlens.scriptObject', 'redlens.generateMockData',
  'redlens.describeObject', 'redlens.showPrivileges', 'redlens.scriptGrants',
  'redlens.effectivePermissions', 'redlens.adminUser', 'redlens.adminRole',
  'redlens.datashare.copyNamespace', 'redlens.datashare.queryObject',
  // act on the open result grid
  'redlens.chartResults', 'redlens.toggleHeatmap', 'redlens.transposeResults',
  'redlens.groupResults', 'redlens.pinBaseline', 'redlens.compareResults',
  'redlens.editTableData', 'redlens.pasteRowsIntoGrid', 'redlens.commitGridEdits',
  // dispatched by other code, never chosen by a user
  'redlens.connectToProfile', 'redlens.cluster.showSection',
  // the padlocks point here; listing it in Tools would put "About Pro" in the
  // catalog next to the features it is offering
  'redlens.proUpsell',
]);
const global = declared.filter((c) => !NOT_IN_TOOLS.has(c));

describe('tools catalog', () => {
  it('lists every global utility, and nothing that belongs to an object', () => {
    const inCatalog = allTools().map((t) => t.command);
    const missing = global.filter((c) => !inCatalog.includes(c));
    // An entry this extension does not declare is only legitimate if it is a
    // Pro feature the other extension owns. Anything else is a typo or a
    // command that was deleted and left behind in the prose.
    const extra = inCatalog.filter((c) => !global.includes(c) && !requiresPro(c));
    expect(missing, `global commands absent from the Tools view: ${missing.join(', ')}`).toEqual([]);
    expect(extra, `catalog lists commands that are neither global nor Pro: ${extra.join(', ')}`).toEqual([]);
  });

  it('every command is either global or deliberately object-scoped', () => {
    // Guards the exclusion list itself against naming a command that is gone.
    const stale = [...NOT_IN_TOOLS].filter((c) => !declared.includes(c) && !requiresPro(c));
    expect(stale, `exclusion list names commands that no longer exist: ${stale.join(', ')}`).toEqual([]);
  });

  it('lists every command once', () => {
    const ids = allTools().map((t) => t.command);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('labels match the command titles in package.json', () => {
    const titleOf = new Map(pkg.contributes.commands.map((c) => [c.command, c.title]));
    // Only for commands declared here. A Pro entry's title lives in the Pro
    // manifest, and the mirror of this check runs there.
    const drifted = allTools()
      .filter((t) => titleOf.has(t.command))
      .filter((t) => titleOf.get(t.command) !== t.label)
      .map((t) => `${t.command}: catalog "${t.label}" vs manifest "${titleOf.get(t.command)}"`);
    expect(drifted).toEqual([]);
  });

  it('only advertises undeclared commands when they are Pro', () => {
    // The catalog is the base's shop window for the paid half. If an entry is
    // neither ours nor Pro, the padlock would lead to a command nobody
    // registers — the exact failure the split has to avoid.
    const undeclared = allTools().map((t) => t.command).filter((c) => !declared.includes(c));
    expect(undeclared.length, 'the catalog no longer advertises Pro at all').toBeGreaterThan(0);
    for (const c of undeclared) {
      expect(requiresPro(c), `${c} is advertised but is not Pro and is not declared here`).toBe(true);
    }
  });

  it('every tool explains itself in one line', () => {
    for (const t of allTools()) {
      expect(t.detail.length, t.command).toBeGreaterThan(20);
      expect(t.detail.length, t.command).toBeLessThan(90);
      expect(t.detail.endsWith('.'), `${t.command} detail should be a sentence`).toBe(true);
    }
  });

  it('groups are few enough to scan and each is non-empty', () => {
    expect(TOOL_GROUPS.length).toBeLessThanOrEqual(8);
    for (const g of TOOL_GROUPS) expect(g.tools.length, g.id).toBeGreaterThan(0);
    const ids = TOOL_GROUPS.map((g) => g.id);
    expect(ids.length).toBe(new Set(ids).size);
  });
});

describe('command palette scope (M9b6)', () => {
  const hidden = new Set(
    (pkg.contributes.menus.commandPalette ?? []).filter((e) => e.when === 'false').map((e) => e.command),
  );
  const visible = declared.filter((c) => !hidden.has(c));

  it('stays a shortcut, not a second catalog', () => {
    // If this grows back toward the full command set, the Tools view has lost
    // its job and the palette is a wall of text again.
    expect(visible.length).toBeLessThanOrEqual(20);
  });

  it('keeps the commands you reach for without leaving the keyboard', () => {
    for (const id of ['redlens.runQuery', 'redlens.explainQuery', 'redlens.showHistory',
      'redlens.nlToSql', 'redlens.manageConnections', 'redlens.statusBarMenu']) {
      expect(visible, `${id} must stay in the palette`).toContain(id);
    }
  });

  it('every palette command is also in the Tools view', () => {
    const inCatalog = new Set(allTools().map((t) => t.command));
    const orphans = visible.filter((c) => !inCatalog.has(c));
    expect(orphans, `in the palette but not in Tools: ${orphans.join(', ')}`).toEqual([]);
  });
});
