import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ISSUES_URL, PRICING_URL, PRIVATE_REPO_URL, SITE_URL, SUPPORT_URL } from '../src/branding';
import { PRO_DIR } from './monorepo';

/**
 * A published extension must not link anywhere its own users cannot reach
 * (Fase D). The paywall's "What is in Pro?" button pointed at
 * github.com/dborjan/redlens — a PRIVATE repository — so every user who clicked
 * the one button designed to sell them something got a 404.
 *
 * These tests are the reason that cannot come back.
 */

function walk(dir: string, acc: { file: string; text: string }[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, acc);
    } else if (name.endsWith('.ts')) {
      acc.push({ file: p, text: readFileSync(p, 'utf8') });
    }
  }
  return acc;
}

const sources = [...walk('src'), ...walk('webview')].filter((s) => !s.file.includes('branding.ts'));

describe('user-facing links', () => {
  it('never sends a user to the private code repository', () => {
    const leaking = sources
      .filter((s) => s.text.includes('github.com/dborjan/redlens'))
      .map((s) => s.file);
    expect(leaking, `these link users at the private repo: ${leaking.join(', ')}`).toEqual([]);
  });

  it('routes every external link through the branding constants', () => {
    // A literal https:// in a command handler is how the private link got there
    // in the first place. Documentation links (docs.aws.amazon.com) and the SVG
    // namespace are the deliberate exceptions.
    const ALLOWED = /^https?:\/\/(docs\.aws\.amazon\.com|www\.w3\.org)/;
    const offenders: string[] = [];
    for (const s of sources) {
      for (const url of s.text.match(/https?:\/\/[^'"`\s)]+/g) ?? []) {
        if (!ALLOWED.test(url)) {
          offenders.push(`${s.file}: ${url}`);
        }
      }
    }
    expect(offenders, `hardcoded external URLs — move them to src/branding.ts: ${offenders.join(', ')}`).toEqual([]);
  });

  it('keeps the manifest support links off the private repo', () => {
    // Pro's manifest is checked here too, because this is the guard that made
    // the paid listing stop pointing buyers at a 404 — but it only exists in
    // the monorepo. See ./monorepo.ts.
    const manifests = ['package.json', ...(PRO_DIR ? [join(PRO_DIR, 'package.json')] : [])];
    for (const manifest of manifests) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
        bugs?: { url?: string };
        homepage?: string;
        repository?: { url?: string } | string;
        qna?: string | false;
      };
      expect(pkg.bugs?.url ?? '', `${manifest}: bugs.url must be a tracker users can open`)
        .not.toContain('dborjan/redlens');

      // `repository` too, and this one was learned the expensive way. The note
      // that used to sit here said a private repository "simply does not
      // render", so it was left unchecked — and the Marketplace rendered it
      // anyway, as a "Project Details" link on the PAID listing, pointing every
      // buyer who clicked it at a 404.
      //
      // A closed extension answers this by omitting the field, not by naming
      // the open repository: its source is not there either, and a link that
      // lies politely is still a link that lies.
      const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? '';
      expect(repo, `${manifest}: repository must be omitted or public — the Marketplace renders it`)
        .not.toContain('dborjan/redlens');
    }
  });
});

describe('branding constants', () => {
  it('are absolute https URLs', () => {
    for (const url of [SITE_URL, PRICING_URL, ISSUES_URL, SUPPORT_URL]) {
      expect(url).toMatch(/^https:\/\/\S+$/);
    }
  });

  it('do not accidentally point at the private repo themselves', () => {
    for (const url of [SITE_URL, PRICING_URL, ISSUES_URL, SUPPORT_URL]) {
      expect(url).not.toContain('dborjan/redlens');
    }
    // Named only so the guard above has something to forbid.
    expect(PRIVATE_REPO_URL).toContain('dborjan/redlens');
  });
});
