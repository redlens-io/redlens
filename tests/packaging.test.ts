import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Guards what leaves the machine inside the .vsix (S-01/S-02).
 *
 * This exists because the previous denylist-style .vscodeignore silently
 * packaged the AWS provisioning scripts (which carry a personal email and AWS
 * resource names), the vm-*.cmd helpers (which carry the lab VM's IP), the built
 * integration-test harness, and raw TypeScript sources. Nothing failed — the
 * package was simply wrong, and would have stayed wrong until someone ran
 * `vsce ls` by hand.
 *
 * These are cheap structural assertions, not a reimplementation of vsce. The
 * authoritative check is still `npx @vscode/vsce ls`; this makes the *stance*
 * (allowlist, and only these paths) impossible to reverse by accident.
 */

const ignore = readFileSync('.vscodeignore', 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'));

/** Only these may ever be re-included. Adding one is a deliberate decision. */
const ALLOWED_INCLUDES = new Set([
  '!package.json',
  '!README.md',
  '!LICENSE.md',
  '!CHANGELOG.md',
  '!NOTICES.md',
  '!dist/extension.js',
  '!dist/mcp-server.js',
  '!dist/webview/*.js',
  '!media/icon.png',
  '!media/icon.svg',
  '!media/walkthrough/*.md',
  '!snippets/*.json',
]);

describe('vsix packaging', () => {
  it('is an allowlist: everything is excluded before anything is added back', () => {
    expect(ignore[0], '.vscodeignore must start by excluding everything').toBe('**');
  });

  it('re-includes only approved paths', () => {
    const includes = ignore.filter((l) => l.startsWith('!'));
    const unexpected = includes.filter((l) => !ALLOWED_INCLUDES.has(l));
    expect(
      unexpected,
      `unapproved re-includes in .vscodeignore: ${unexpected.join(', ')}. ` +
        'Anything added here ships to every user — confirm with `npx @vscode/vsce ls`.',
    ).toEqual([]);
  });

  it('never re-includes a whole directory, which would drag in source maps', () => {
    // In vsce a `!` rule wins over every exclusion regardless of order, so a
    // `!dir/**` can never be narrowed afterwards — the .map files come along
    // permanently and re-expose the full source.
    const wildcards = ignore.filter((l) => l.startsWith('!') && l.endsWith('/**'));
    expect(wildcards, `use an explicit extension instead of ${wildcards.join(', ')}`).toEqual([]);
  });

  it('excludes source maps from the package', () => {
    const includes = ignore.filter((l) => l.startsWith('!'));
    expect(includes.some((l) => l.endsWith('.map'))).toBe(false);
  });
});

describe('marketplace manifest', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, unknown>;

  it('is not marked private (vsce refuses to package a private package)', () => {
    expect(pkg.private).toBeUndefined();
  });

  it('declares the fields the Marketplace listing needs', () => {
    for (const field of ['name', 'displayName', 'description', 'version', 'publisher', 'license', 'repository']) {
      expect(pkg[field], `manifest is missing "${field}"`).toBeDefined();
    }
  });

  it('does not leak a local path or an internal host in the manifest', () => {
    const json = JSON.stringify(pkg);
    expect(json).not.toMatch(/C:\\\\|\/home\/dbo|192\.168\./);
  });

  it('does not leak a local path or an internal host in the SHIPPED docs either', () => {
    // The manifest was checked but README/LICENSE/CHANGELOG/NOTICES also ship,
    // and the README used to carry the lab VM's IP and Windows paths in its
    // build instructions. Those moved to CONTRIBUTING.md, which does NOT ship.
    for (const file of ['README.md', 'LICENSE.md', 'CHANGELOG.md', 'NOTICES.md']) {
      const text = readFileSync(file, 'utf8');
      expect(text, `${file} ships to every user and leaks an internal host`).not.toMatch(/192\.168\./);
      expect(text, `${file} ships to every user and leaks a local path`).not.toMatch(/C:\\\\virtualization|\/home\/dbo/);
    }
  });

  it('declares a pricing value the Marketplace accepts', () => {
    // Case-sensitive, and only these two exist — "Paid" is not a value.
    expect(['Free', 'Trial']).toContain(pkg.pricing);
  });

  it('declares MIT as an SPDX id, with the file present', () => {
    // An SPDX identifier rather than "SEE LICENSE IN …", which is what this
    // said while the whole product was under one EULA. The Marketplace renders
    // a recognised SPDX id as a licence badge on the listing; the free-text
    // form renders as "SEE LICENSE IN LICENSE.md", which tells a browsing
    // developer nothing about whether they can use it.
    expect(pkg.license).toBe('MIT');
    // The filename match is case-sensitive; a mismatch makes vsce prompt
    // interactively and hang a scripted package run.
    const text = readFileSync('LICENSE.md', 'utf8');
    expect(text).toContain('MIT License');
    expect(text, 'the EULA must not be what ships with the open extension')
      .not.toContain('End User Licence Agreement');
  });
});

describe('packaging cannot be run from inside the workspace', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

  it('refuses instead of quietly packaging the monorepo', () => {
    // The .vscodeignore allowlist is rooted at this package, so it says nothing
    // about paths ABOVE it — and inside an npm workspace, vsce follows the
    // hoisted root node_modules and walks up out of the package entirely.
    // Measured before this guard existed: `vsce ls` here listed thousands of
    // files from ../../node_modules, and the same command in the Pro package
    // listed 8,456 including the internal plan, the lab scripts and the docs.
    //
    // Every other test in this file reads the .vscodeignore TEXT, and the text
    // was correct the whole time. Only a real `vsce ls` sees this, which is why
    // the guard has to live in the script rather than in an assertion.
    // It must FAIL rather than run vsce. (The refusal message names vsce, so
    // "does not mention vsce" would be the wrong assertion — what matters is
    // that the script exits non-zero and points at the supported path.)
    expect(pkg.scripts.package, 'the package script must fail, not package').toContain('process.exit(1)');
    expect(pkg.scripts.package, 'it must point at the supported path').toContain('package-extension.sh');
    expect(pkg.scripts.package, 'it must not actually invoke vsce').not.toMatch(/(^|[^-\w])vsce (package|ls)/);
  });
});
