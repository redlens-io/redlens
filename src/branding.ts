/**
 * Every URL a user can click, in one place (Fase D).
 *
 * These used to point at `github.com/dborjan/redlens`, which is PRIVATE: anyone
 * who installed the extension and clicked "What is in Pro?" got a 404 from a
 * repository they will never have access to. A published extension must not
 * link anywhere its own users cannot reach.
 *
 * They live here as constants so switching the public home is one edit, and
 * `tests/branding.test.ts` fails if the private repository ever comes back.
 *
 * Decision (Diego, 2026-07-27): **GitHub Pages instead of a bought domain.**
 * The site `lensql.dev` serves /pricing, /privacy, /support, the
 * public docs AND the listing images — free, HTTPS, no DNS to manage. A custom
 * domain can be layered on later without breaking these URLs (Pages redirects).
 *
 */

/** Public home. Shown in the listing and used as the base for everything else. */
export const SITE_URL = 'https://lensql.dev';

/** Where "What is in Pro?" and the pricing disclosure point. */
export const PRICING_URL = `${SITE_URL}/pricing`;

/**
 * Where "Buy a licence" goes — the thing 1.0.0 and 1.0.1 did not have (1.0.2).
 *
 * Until this existed the funnel was a dead end: the padlock offered "What is in
 * Pro?", that opened the pricing page, and the pricing page described buying a
 * key without linking anywhere that sells one. Everything downstream —
 * activation, renewal, grace, deactivation — was built and tested against a
 * purchase nobody could make.
 *
 * It points at OUR site, not at the payment processor's checkout, and that is
 * deliberate. A URL inside a published .vsix keeps being called by installs that
 * already have it and cannot be taken back: a checkout link embedded here would
 * become a dead button in every existing install the day the product, the price
 * or the merchant changes. `/buy` is a redirect page we control, so that day
 * costs one commit to the site instead of a release nobody can force people to
 * install. Same reasoning as API_HOST below.
 */
export const PURCHASE_URL = `${SITE_URL}/buy`;

/** Public issue tracker. Since the open-core split this is the base extension's
 * own repository: the code and the conversation about it in one place, which is
 * what the separate `feedback` repo was standing in for while the source was
 * private. */
export const ISSUES_URL = 'https://github.com/redlens-io/redlens/issues';

/** Support contact for the Marketplace listing. */
export const SUPPORT_URL = `${SITE_URL}/support`;

/** Where telemetry goes when — and only when — the user has allowed it.
 *
 * The same Worker that issues entitlements, on a separate path. It stores
 * nothing: the endpoint exists so the extension can prove it sends NOTHING
 * while telemetry is off, and an endpoint that keeps no data cannot become a
 * liability while that is being demonstrated.
 *
 * The host is the PRODUCT's domain, deliberately, and never the Cloudflare
 * account's `*.workers.dev` hostname. Two reasons, and the second is the one
 * that bites: that hostname is derived from the account holder's name, and
 * Cloudflare fixes it permanently — `PUT /workers/subdomain` on an account that
 * already has one returns 10036 "Account already has an associated subdomain".
 * It cannot be renamed, only abandoned. Shipping it would have put a personal
 * name in every telemetry call of a commercial product, forever, because a URL
 * inside a published .vsix keeps being called by installs that already have it.
 *
 * api.lensql.dev is not live yet — it waits on the domain's registrant
 * validation. That is the correct failure mode: telemetry that cannot resolve
 * sends nothing, which is what this endpoint promises anyway. An unresolvable
 * host is a far smaller problem than an unremovable name. */
export const API_HOST = 'https://api.lensql.dev';
export const TELEMETRY_URL = `${API_HOST}/t`;

/** Extension id of RedLens Pro, and where to get it (Fase O).
 *
 * The base never imports Pro's code, but it does have to be able to point at
 * it: a padlock the user cannot act on is worse than no padlock at all. This
 * is the only knowledge of Pro the open extension carries — an id and a URL. */
export const PRO_EXTENSION_ID = 'lensql.redlens-pro';
export const PRO_MARKETPLACE_URL = `https://marketplace.visualstudio.com/items?itemName=${PRO_EXTENSION_ID}`;

/** The private repository — RedLens Pro's source and the project's archive.
 * Exported ONLY so the guard test can name the thing it forbids: a user who
 * clicks a link there gets a 404 from a repository they will never have access
 * to. Never link a user here. */
export const PRIVATE_REPO_URL = 'https://github.com/lensql/redlens';

/** Every path that reaches the private repository — the current one and the
 * name it had before moving to the LenSQL org on 2026-08-20.
 *
 * The old name is here, not deleted, because GitHub still redirects it: a link
 * written last month sends the user to exactly the same 404 as one written
 * today. A guard that forbids only the current spelling stops protecting every
 * file that predates the move, which is most of them. */
export const PRIVATE_REPO_PATHS = ['lensql/redlens', 'dborjan/redlens'] as const;
