import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DOCS_DIR } from './monorepo';

/**
 * Every image the manual shows is one the harness can take again.
 *
 * Five of them were not. `08-unload-sql`, `28-scheduled-queries`,
 * `29-schema-compare`, `32-data-compare` and `41-licence` had no capture in
 * `integration/shots.ts` at all, so they sat frozen at 2026-07-30 while
 * MANUAL-DE-USO.md and four utility pages went on pointing at them. The manual
 * documented an older product than the one that shipped — including a licence
 * screen from before it could sell anything — and no run could have fixed it,
 * because nothing was trying.
 *
 * A stale screenshot fails the way the frozen trial counter did: it keeps
 * answering, so nothing looks broken. This is the check that notices.
 */

// The manual lives at the workspace root, not inside this package, so this
// whole file is a monorepo question: the public MIT mirror ships the extension
// without docs/, and there are no images there to be stale. See ./monorepo.ts.
const IMG_DIR = DOCS_DIR === null ? null : join(DOCS_DIR, 'manual', 'img');
const shots = readFileSync(join(__dirname, '..', 'integration', 'shots.ts'), 'utf8');

/** Every filename the harness captures, however it names it. */
function capturedNames(): Set<string> {
  const names = new Set<string>();
  // capture('x.png') and capture('x.png', { … })
  for (const m of shots.matchAll(/\bcapture\('([^']+\.png)'/g)) names.add(m[1]!);
  // proCapture('command', 'x.png')
  for (const m of shots.matchAll(/proCapture\('[^']+',\s*'([^']+\.png)'/g)) names.add(m[1]!);
  // the table-driven block: ['command', 'x.png', …]
  for (const m of shots.matchAll(/'[^']+',\s*'([^']+\.png)'/g)) names.add(m[1]!);
  return names;
}

const onDisk = IMG_DIR === null ? [] : readdirSync(IMG_DIR).filter((f) => f.endsWith('.png'));
const captured = capturedNames();

describe.skipIf(IMG_DIR === null)('the manual is made of images the harness can retake', () => {
  it('has a capture for every screenshot it ships', () => {
    const orphans = onDisk.filter((f) => !captured.has(f));
    expect(
      orphans,
      'these live in docs/manual/img and no capture in integration/shots.ts produces them, '
        + 'so they can only ever go stale: ' + orphans.join(', '),
    ).toEqual([]);
  });

  it('captures nothing that has since been deleted', () => {
    // The inverse. A capture writing a file the manual no longer shows is dead
    // work in every run, and usually the leftover of a rename that took the
    // reference with it but not the shot.
    const ghosts = [...captured].filter((f) => !onDisk.includes(f));
    expect(ghosts, `captured but absent from docs/manual/img: ${ghosts.join(', ')}`).toEqual([]);
  });

  it('actually found some, so a broken matcher cannot pass this file', () => {
    expect(onDisk.length).toBeGreaterThan(40);
    expect(captured.size).toBeGreaterThan(40);
  });
});
