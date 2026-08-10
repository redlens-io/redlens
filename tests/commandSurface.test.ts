import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { allTools } from '../src/tools/catalog';

/**
 * Guards the command surface itself (M9b1). Two classes of regression this
 * catches, both of which actually happened while building M9:
 *
 *  1. Hiding a command from the palette that has no OTHER entry point — the
 *     user can no longer invoke it at all. (Caught `mapView`, which opens its
 *     own table picker and has no button or menu.)
 *  2. Drifting away from the naming scheme: the product name back inside a
 *     title, a missing `category`, or an `(internal)` marker leaking into the
 *     Keyboard Shortcuts UI.
 */

interface Cmd { command: string; title: string; category?: string; enablement?: string; icon?: string }
interface MenuEntry { command?: string; when?: string; submenu?: string }

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  contributes: { commands: Cmd[]; menus: Record<string, MenuEntry[]> };
};
const commands = pkg.contributes.commands;
const menus = pkg.contributes.menus;

function readTs(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) readTs(p, acc);
    else if (name.endsWith('.ts')) acc.push(readFileSync(p, 'utf8'));
  }
  return acc;
}
const sources = [...readTs('src'), ...readTs('webview')].join('\n');

/** Grid-scoped actions live on the results toolbar, not in the palette. */
const WEBVIEW_BUTTON: Record<string, string> = {
  'redlens.chartResults': "btn-chart",
  'redlens.toggleHeatmap': "btn-heat",
  'redlens.transposeResults': "btn-transpose",
  'redlens.pinBaseline': "btn-pin",
  'redlens.compareResults': "btn-compare",
  'redlens.editTableData': "btn-edit",
  'redlens.commitGridEdits': "btn-commit",
  'redlens.groupResults': "group-sel",
  'redlens.pasteRowsIntoGrid': "addEventListener('paste'",
};

const hidden = (menus.commandPalette ?? []).filter((e) => e.when === 'false').map((e) => e.command);
const inOtherMenus = new Set(
  Object.entries(menus)
    .filter(([name]) => name !== 'commandPalette')
    .flatMap(([, entries]) => entries.map((e) => e.command).filter(Boolean) as string[]),
);

describe('command surface — reachability', () => {
  it('every command hidden from the palette has another entry point', () => {
    // Since M9b6 most commands are palette-hidden by design, so this check is
    // what stands between "moved to the sidebar" and "silently unreachable".
    const inToolsView = new Set(allTools().map((t) => t.command));
    const dead = hidden.filter((id) => {
      if (id === undefined) return false;
      if (inToolsView.has(id)) return false;                           // Tools view leaf
      if (inOtherMenus.has(id)) return false;                          // context/title menu
      const btn = WEBVIEW_BUTTON[id];
      if (btn !== undefined && sources.includes(btn)) return false;    // results toolbar
      return !sources.includes(`'${id}'`);                             // TreeItem.command / code dispatch
    });
    expect(dead, `hidden but unreachable: ${dead.join(', ')}`).toEqual([]);
  });

  it('every menu entry points at a declared command', () => {
    const declared = new Set(commands.map((c) => c.command));
    const orphans = Object.entries(menus).flatMap(([menu, entries]) =>
      entries.filter((e) => e.command !== undefined && !declared.has(e.command)).map((e) => `${menu}:${e.command}`),
    );
    expect(orphans).toEqual([]);
  });
});

describe('command surface — naming scheme', () => {
  it('the product name lives in `category`, never in a title', () => {
    expect(commands.filter((c) => c.category !== 'RedLens').map((c) => c.command)).toEqual([]);
    expect(commands.filter((c) => /redlens/i.test(c.title)).map((c) => c.command)).toEqual([]);
  });

  it('no implementation markers leak into user-visible titles', () => {
    // These still show in the Keyboard Shortcuts UI even when palette-hidden.
    expect(commands.filter((c) => /\(internal\)|TODO|WIP/i.test(c.title)).map((c) => c.command)).toEqual([]);
  });

  it('titles are short and start with a capital', () => {
    const bad = commands.filter((c) => c.title.split(' ').length > 5 || !/^[A-Z]/.test(c.title));
    expect(bad.map((c) => `${c.command}: ${c.title}`)).toEqual([]);
  });

  it('SQL-generating commands all use the single verb "Script"', () => {
    // Five of the original seven moved to the Pro extension in the Fase O
    // split, where the same rule is enforced against that manifest. Naming
    // stays one product's naming across two listings, so the check is "every
    // generator THIS manifest declares", not a fixed list that would quietly
    // pass by finding nothing.
    const generators = ['redlens.scriptObject', 'redlens.scriptGrants'];
    for (const id of generators) {
      const cmd = commands.find((c) => c.command === id);
      expect(cmd, `${id} is no longer declared here`).toBeDefined();
      expect(cmd?.title, `${id} should start with Script`).toMatch(/^Script /);
    }
  });

  it('has no AI commands left to name', () => {
    // The "… with AI" suffix rule did not go away — it moved. All five AI
    // commands are Pro now, and the rule is enforced against the Pro manifest
    // in that package's own suite. What this asserts is the split itself: an
    // AI command reappearing here would mean paid code came back.
    const ai = commands.filter((c) => /\bAI\b/.test(c.title));
    expect(ai.map((c) => c.command), 'AI is Pro — these belong in the other manifest').toEqual([]);
  });
});

describe('command surface — enablement', () => {
  it('every enablement context is actually set by the extension', () => {
    // A typo here would disable the command forever, silently.
    const used = new Set(
      commands.flatMap((c) => (c.enablement ?? '').match(/redlens\.[A-Za-z]+/g) ?? []),
    );
    const missing = [...used].filter((ctx) => !sources.includes(`'${ctx}'`));
    expect(missing, `enablement uses contexts nothing sets: ${missing.join(', ')}`).toEqual([]);
  });
});
