import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PRO_DIR } from './monorepo';

/**
 * Every hostname in shipped source must belong to the PRODUCT.
 *
 * This is an allowlist, not a list of forbidden names, and the shape matters.
 * The obvious version of this test — "the author's name must not appear" —
 * would have to spell that name out, in a file that ships in a PUBLIC MIT
 * package. It would publish the very thing it exists to keep out. An allowlist
 * names only what is already public on purpose, and it is strictly stronger: it
 * catches hosts nobody thought to forbid.
 *
 * WHAT THIS WAS WRITTEN FOR. The telemetry endpoint shipped as
 * `redlens-entitlement.<account>.workers.dev`, where `<account>` is derived from
 * the Cloudflare account holder's legal name. Two things made that worse than an
 * ordinary mistake:
 *
 *   · Cloudflare fixes that subdomain permanently. `PUT /workers/subdomain` on
 *     an account that already has one returns 10036, "Account already has an
 *     associated subdomain". It cannot be renamed — only abandoned.
 *   · A URL inside a published .vsix is not retractable. Installs that already
 *     have it keep calling it, so the name would have outlived any later fix.
 *
 * And nothing would have reported it: telemetry is deliberately built never to
 * complain, so a wrong host produces silence, which is also what a correct host
 * produces when the user has telemetry off.
 *
 * Adding a host here is a real decision — it means that host is part of the
 * product's public surface. It is not a formality to be waved through when the
 * test goes red.
 */

const ALLOWED = new Set([
  // The product's own domain and its subdomains.
  'lensql.dev',
  // The public repo and the store listing.
  'github.com',
  'marketplace.visualstudio.com',
  // redlens-io.github.io is deliberately NOT here any more: the site moved to
  // lensql.dev on 2026-08-12, and GitHub's redirect from the old host passes
  // through plain HTTP. A link that takes an insecure hop from an HTTPS page can
  // be refused by the browser, so the old host must not reappear in shipped
  // source — this list is what makes that a test failure rather than a surprise.
  // Documentation the extension links out to.
  'docs.aws.amazon.com',
  // XML namespaces in SVG assets — a URI, not a place anything connects to.
  'www.w3.org',
]);

/** `api.lensql.dev` is allowed by `lensql.dev`; `lensql.dev.evil.com` is not. */
function isAllowed(host: string): boolean {
  return [...ALLOWED].some((a) => host === a || host.endsWith(`.${a}`));
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  // A root may be a single file (a README) rather than a directory.
  if (!statSync(dir).isDirectory()) {
    acc.push(dir);
    return acc;
  }
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'out') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx|js|json|md)$/.test(entry)) acc.push(full);
  }
  return acc;
}

describe('every hostname in shipped source belongs to the product', () => {
  // src/ AND the READMEs. The READMEs were missed at first and it cost a
  // release: Pro's still linked the retired host after everything in src/ had
  // moved, because the guard could not see it. What ships is what must be
  // checked, and a README ships inside the .vsix and renders on the store page.
  const roots = [
    join(__dirname, '..', 'src'),
    join(__dirname, '..', 'README.md'),
      // The licence and notices ship too, and the EULA is the densest source of
      // links in the whole package — support, privacy, security, and the archive
      // of its own superseded versions. It was left out of this list for no
      // better reason than that the READMEs were the ones that had gone wrong.
      join(__dirname, '..', 'LICENSE.md'),
      join(__dirname, '..', 'NOTICES.md'),
    // Pro's shipped surface, which exists only in the monorepo. In the public
    // MIT mirror this package is the whole repository and there is no paid half
    // to sweep — see ./monorepo.ts.
    ...(PRO_DIR
      ? [
          join(PRO_DIR, 'src'),
          join(PRO_DIR, 'README.md'),
          join(PRO_DIR, 'LICENSE.md'),
          join(PRO_DIR, 'NOTICES.md'),
        ]
      : []),
  ];

  if (PRO_DIR === null) {
    // Registered so the absence is VISIBLE in the runner's output. A suite that
    // is quietly four tests shorter in one checkout than another is how a guard
    // stops running without anyone deciding that it should.
    it.skip("Pro's shipped source — no Pro package in this checkout", () => {});
  }

  for (const root of roots) {
    it(`${root.split('/').slice(-2).join('/')} points only at product hosts`, () => {
      const strays: string[] = [];

      for (const file of sourceFiles(root)) {
        const text = readFileSync(file, 'utf8');
        for (const match of text.matchAll(/https?:\/\/([a-zA-Z0-9._-]+)/g)) {
          const host = match[1];
          if (host && !isAllowed(host)) {
            strays.push(`${file.split('/').slice(-2).join('/')}: ${host}`);
          }
        }
      }

      expect(
        [...new Set(strays)],
        'A host outside the product appeared in shipped source. If it is genuinely '
          + 'part of the product, add it to ALLOWED above — deliberately. If it is an '
          + 'infrastructure hostname (a *.workers.dev subdomain, a personal or company '
          + 'domain, an IP), it must NOT ship: a URL in a published .vsix keeps being '
          + 'called by installs that already have it, and cannot be taken back.',
      ).toEqual([]);
    });
  }
});
