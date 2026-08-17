import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRO_DIR } from './monorepo';
import { PRO_EXTENSION_ID } from '../src/branding';

/**
 * Every Marketplace link in shipped documentation points at an extension that
 * exists.
 *
 * WHAT THIS WAS WRITTEN FOR. RedLens Pro shipped with this as the first
 * sentence of its README:
 *
 *   The paid half of [RedLens](…?itemName=redlens.redlens), …
 *
 * The publisher is `lensql`, not `redlens`, so the id was `lensql.redlens` and
 * that link was a 404 from the day it was published. It is the link from the
 * PAID extension to the free one it declares as a dependency — the single most
 * important link on that page — and it was broken on the store for every
 * visitor.
 *
 * The same URL is built correctly everywhere it is BUILT: `src/branding.ts`
 * composes `PRO_MARKETPLACE_URL` from `PRO_EXTENSION_ID`, so the in-editor
 * upsell always worked. It was only wrong where a human typed it into prose,
 * which is exactly the place no compiler looks.
 *
 * The ids are derived from the manifests rather than listed here, so this
 * cannot drift: rename a package or move to a different publisher and the
 * expectation moves with it.
 *
 * It deliberately does NOT ask the gallery over the network. A test that needs
 * the internet fails for reasons that have nothing to do with the code, and the
 * failure this guards against — a typo in an id — is fully decidable offline.
 *
 * It matches ids only inside a real Marketplace URL, never a bare `itemName=`.
 * The first draft matched the bare form and immediately failed on the changelog
 * entry announcing this very fix, which quotes the broken id in order to explain
 * it. A guard that cannot tell a link from its own documentation is a guard
 * people learn to work around — the same lesson the retired-host sweep in
 * `export-guards.sh` had to learn. The defect being prevented was a live link,
 * so a live link is what this looks for.
 */

const BASE_DIR = join(__dirname, '..');

function idOf(pkgDir: string): string {
  const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
    publisher: string;
    name: string;
  };
  return `${pkg.publisher}.${pkg.name}`;
}

/** Docs that travel inside a .vsix and render on the store page. */
function shippedDocs(pkgDir: string): string[] {
  return ['README.md', 'CHANGELOG.md', 'LICENSE.md', 'NOTICES.md']
    .map((f) => join(pkgDir, f))
    .filter((f) => existsSync(f));
}

/**
 * Pro's id comes from `src/branding.ts`, not from Pro's manifest.
 *
 * This package has two lives, and in the public MIT mirror there IS no Pro
 * manifest — but base's README still links to Pro's store page, deliberately,
 * because that is where the free trial starts. Deriving the id only from
 * manifests made the mirror's CI reject a link that is correct, public and
 * intentional. It failed on the very first tag-driven release.
 *
 * `PRO_EXTENSION_ID` is base's own declaration of what Pro is called; it is what
 * the in-editor upsell already resolves, and it ships in both repositories. That
 * makes it the right source, and it sharpens the test: prose in the README now
 * has to agree with the constant the CODE uses, which is exactly the agreement
 * that was broken when Pro's README said `redlens.redlens`.
 */
const known = new Set<string>([idOf(BASE_DIR), PRO_EXTENSION_ID]);
const docs = [...shippedDocs(BASE_DIR), ...(PRO_DIR ? shippedDocs(PRO_DIR) : [])];

describe('Marketplace links in shipped docs', () => {
  it('knows which extension ids exist', () => {
    // If this ever reads an empty set, every assertion below passes vacuously.
    expect(known.size).toBeGreaterThanOrEqual(2);
    expect([...known].every((id) => /^[\w-]+\.[\w-]+$/.test(id))).toBe(true);
  });

  // Only checkable where both halves are present — and worth checking, because
  // the whole point of sourcing the id from branding.ts is that it is the same
  // id Pro actually publishes under.
  it.runIf(PRO_DIR !== null)('branding.ts agrees with Pro\'s own manifest', () => {
    expect(PRO_EXTENSION_ID).toBe(idOf(PRO_DIR!));
  });

  for (const doc of docs) {
    const label = doc.split('/').slice(-2).join('/');

    it(`${label} names only extensions that exist`, () => {
      const text = readFileSync(doc, 'utf8');
      const cited = [
        ...text.matchAll(
          /marketplace\.visualstudio\.com\/items\?itemName=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g,
        ),
      ].map((m) => m[1]!);

      const wrong = [...new Set(cited)].filter((id) => !known.has(id));

      expect(
        wrong,
        `${label} links to Marketplace ids that do not exist: ${wrong.join(', ')}. `
          + `The real ids are ${[...known].join(' and ')}. This is how Pro shipped a `
          + `README whose first sentence 404'd — the publisher is 'lensql', and `
          + `'redlens' is only the extension name.`,
      ).toEqual([]);
    });
  }

  if (PRO_DIR === null) {
    it.skip("Pro's shipped docs — no Pro package in this checkout", () => {});
  }
});
