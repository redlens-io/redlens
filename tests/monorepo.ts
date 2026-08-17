import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Whether the paid half of the product is standing next to us.
 *
 * This package has two lives. In the monorepo it sits beside `packages/pro` and
 * a `docs/` tree, and several of its tests assert things ACROSS that boundary:
 * that Pro's README names a price the catalogue can charge, that Pro's licence
 * command offers a way to cancel, that no shipped file in either package points
 * at a host outside the product. Those are the tests that caught the funnel bug
 * — every piece correct, the path between them missing — and they only exist
 * because something looks at both halves at once.
 *
 * Its other life is `github.com/redlens-io/redlens`, the public MIT mirror,
 * which contains this package and nothing else. Over there `../pro` is not
 * missing-and-broken; it is a question that does not apply. A test asserting
 * things about Pro's README in a repository with no Pro is not a weaker test,
 * it is a test with no subject.
 *
 * So: detected POSITIVELY, by the workspace manifest, rather than by catching
 * the ENOENT from a file that should have been there. The difference matters.
 * "I could not read it, so never mind" is the shape of every silent failure
 * this project has been bitten by — the screenshot harness whose `catch {}`
 * produced a wrong image instead of a missing one, the sync that could only add
 * and so proved a move that never happened. A missing file inside a monorepo we
 * HAVE identified still fails loudly, because by then it is a real absence.
 */
function findWorkspaceRoot(): string | null {
  // tests/ -> packages/base -> packages -> the workspace
  const root = join(__dirname, '..', '..', '..');
  const manifest = join(root, 'package.json');
  if (!existsSync(manifest)) return null;
  // Not wrapped in a try: a package.json that exists and does not parse is a
  // broken checkout, and should say so rather than quietly become "standalone".
  const name = JSON.parse(readFileSync(manifest, 'utf8')).name;
  return name === 'redlens-workspace' ? root : null;
}

/** The monorepo root, or null in a standalone checkout of this package. */
export const MONOREPO_ROOT: string | null = findWorkspaceRoot();

/** `packages/pro`, or null when this package stands alone. */
export const PRO_DIR: string | null =
  MONOREPO_ROOT === null ? null : join(MONOREPO_ROOT, 'packages', 'pro');

/** The workspace `docs/` tree, or null when this package stands alone. */
export const DOCS_DIR: string | null =
  MONOREPO_ROOT === null ? null : join(MONOREPO_ROOT, 'docs');
