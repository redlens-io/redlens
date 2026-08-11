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
 * The org site `redlens-io.github.io` serves /pricing, /privacy, /support, the
 * public docs AND the listing images — free, HTTPS, no DNS to manage. A custom
 * domain can be layered on later without breaking these URLs (Pages redirects).
 *
 */

/** Public home. Shown in the listing and used as the base for everything else. */
export const SITE_URL = 'https://redlens-io.github.io';

/** Where "What is in Pro?" and the pricing disclosure point. */
export const PRICING_URL = `${SITE_URL}/pricing`;

/** Public issue tracker. Since the open-core split this is the base extension's
 * own repository: the code and the conversation about it in one place, which is
 * what the separate `feedback` repo was standing in for while the source was
 * private. */
export const ISSUES_URL = 'https://github.com/redlens-io/redlens/issues';

/** Support contact for the Marketplace listing. */
export const SUPPORT_URL = `${SITE_URL}/support`;

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
export const PRIVATE_REPO_URL = 'https://github.com/dborjan/redlens';
