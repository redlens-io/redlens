import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PURCHASE_URL, SITE_URL } from '../src/branding';
import { PRO_DIR } from './monorepo';

/**
 * The buyer's question, as a test: **where do I click to pay?** (1.0.2)
 *
 * RedLens shipped 1.0.0 with a licence system validated end to end — Ed25519
 * verification, activation, machine binding, renewal, grace, refunds, every
 * Polar state — and no way to buy a licence. The pricing page described
 * purchasing a key and linked to nothing that sells one; Polar held zero
 * checkout links; the padlock offered "What is in Pro?" and the licence command
 * asked people to paste a key from a purchase they could not make. Everything
 * downstream of the payment was tested. The payment was not.
 *
 * Nothing in the old gate could see it, because every individual piece was
 * correct. What was missing was a path, and a path is only visible if something
 * walks it. These tests walk it.
 */

// Pro's half of the funnel exists only in the monorepo; the public MIT mirror
// is this package alone. Where Pro is absent the buyer's path still has to be
// walkable as far as it goes here — the base README's prices, the upsell's
// checkout link — and the assertions that name a Pro file are registered as
// skipped rather than dropped. See ./monorepo.ts.
const readmes = {
  'base/README.md': readFileSync(join(__dirname, '..', 'README.md'), 'utf8'),
  ...(PRO_DIR ? { 'pro/README.md': readFileSync(join(PRO_DIR, 'README.md'), 'utf8') } : {}),
};

const surfaces = {
  'base/src/commands/proUpsell.ts': readFileSync(join(__dirname, '..', 'src', 'commands', 'proUpsell.ts'), 'utf8'),
  ...(PRO_DIR
    ? {
        'pro/src/commands/license.ts': readFileSync(join(PRO_DIR, 'src', 'commands', 'license.ts'), 'utf8'),
        'pro/src/branding.ts': readFileSync(join(PRO_DIR, 'src', 'branding.ts'), 'utf8'),
      }
    : {}),
};

/** Skips a Pro-side assertion, visibly, when there is no Pro package here. */
const itPro = PRO_DIR ? it : it.skip;

describe('a user who wants to pay can', () => {
  it('has a purchase URL on the product site', () => {
    expect(PURCHASE_URL).toMatch(/^https:\/\/\S+$/);
    expect(PURCHASE_URL.startsWith(`${SITE_URL}/`)).toBe(true);
  });

  it('never compiles the payment processor into the extension', () => {
    // The checkout link is retargetable precisely because it is NOT in here: a
    // URL inside a published .vsix keeps being called by installs that already
    // have it. `/buy` on our own site redirects, so changing product, price or
    // merchant costs one commit instead of a release nobody can force.
    for (const [name, text] of Object.entries({ ...surfaces, 'base/src/branding.ts': readFileSync(join(__dirname, '..', 'src', 'branding.ts'), 'utf8') })) {
      expect(text, `${name} must link at ${SITE_URL}/buy, not at a checkout host`).not.toMatch(/polar\.sh/);
    }
  });

  it('is offered the purchase from the padlock', () => {
    // The surface a locked feature ends at when Pro is not installed.
    expect(surfaces['base/src/commands/proUpsell.ts']).toContain('PURCHASE_URL');
    expect(surfaces['base/src/commands/proUpsell.ts']).toContain('Buy a licence');
  });

  itPro('is offered the purchase from Pro\'s own licence command too', () => {
    // The other surface: Pro is installed, and the licence command is where
    // someone without a key arrives.
    expect(surfaces['pro/src/commands/license.ts']).toContain('PURCHASE_URL');
    expect(surfaces['pro/src/commands/license.ts']).toContain('Buy a licence');
  });

  it('finds a buy link on both Marketplace listings', () => {
    // The README *is* the store page. A listing that names a price without
    // linking a checkout is the 1.0.0 bug rendered at full size.
    for (const [name, text] of Object.entries(readmes)) {
      expect(text, `${name} names no way to buy`).toContain(PURCHASE_URL);
    }
  });
});

describe('what we tell a buyer to expect after paying', () => {
  /**
   * The key does NOT arrive by email, and every shipped surface used to say it
   * did — READMEs, the pricing page, the thank-you page, and the licence
   * command's own prompt. A real purchase settled it: Polar's receipt names the
   * benefit and carries an "Access purchase" button, the key lives in the
   * customer portal behind it, and Polar has no benefit-delivery email to turn
   * on. Someone following those instructions searches their inbox, finds no
   * key, and concludes the payment failed.
   *
   * That is the pricing-page-with-no-checkout bug wearing different clothes: a
   * documented path that does not exist. This is the guard that keeps the claim
   * from drifting back in.
   */
  const CLAIMS = [/\bkey\b[^.]{0,40}\barrives by email\b/i, /\breceive it by email\b/i];

  for (const [name, text] of Object.entries({ ...readmes, ...surfaces })) {
    it(`${name} does not promise the key by email`, () => {
      const found = CLAIMS.flatMap((re) => text.match(re) ?? []);
      expect(
        found,
        'The licence key is delivered through the customer portal, not by email. '
          + 'Saying otherwise sends a paying customer hunting through their inbox for '
          + 'something that was never sent.',
      ).toEqual([]);
    });
  }
});

describe('a user who wants to leave can', () => {
  // The same defect as the missing checkout, at the other end of the
  // relationship: everything the product said about cancelling pointed at "the
  // portal linked in your purchase confirmation" — a dead end for anyone who
  // lost the email, and no clickable answer at all inside the editor. Someone
  // who cannot find the way out has been given a reason not to walk in.
  const ACCOUNT_URL = `${SITE_URL}/account`;

  itPro('is offered the account portal from the licence command', () => {
    expect(surfaces['pro/src/branding.ts']).toContain('ACCOUNT_URL');
    expect(surfaces['pro/src/commands/license.ts']).toContain('ACCOUNT_URL');
    expect(surfaces['pro/src/commands/license.ts']).toContain('cancel');
  });

  it('finds it on both Marketplace listings too', () => {
    for (const [name, text] of Object.entries(readmes)) {
      expect(text, `${name} says nothing about how to cancel`).toContain(ACCOUNT_URL);
    }
  });
});

describe('published prices', () => {
  /**
   * The prices that actually exist in the Polar catalogue. The truth is over
   * there, not here — this list is the promise that shipped copy repeats it
   * faithfully, and the test that fails when it stops.
   *
   * It exists because 1.0.0 and 1.0.1 shipped a listing quoting **$199 per user
   * for Team** (the live product charges $79 per seat, 2.5× less) and an "early
   * adopters: $79 for the first year" discount that had never been created in
   * Polar at all. Both were leftovers from a superseded decision, on the one
   * page a buyer reads before paying.
   */
  const PUBLISHED = new Set(['$99', '$79']);

  for (const [name, text] of Object.entries(readmes)) {
    it(`${name} quotes only prices that can be charged`, () => {
      const quoted = [...new Set(text.match(/\$[\d,.]+/g) ?? [])];
      const wrong = quoted.filter((p) => !PUBLISHED.has(p));
      expect(
        wrong,
        'A price appears in shipped copy that is not in the Polar catalogue. '
          + 'Change the catalogue first, then this list, then the copy — in that '
          + 'order, so no listing ever quotes a number checkout will not honour.',
      ).toEqual([]);
    });
  }
});
