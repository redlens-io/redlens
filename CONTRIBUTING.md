# Contributing to RedLens

Thanks for looking. RedLens is open core: **this repository is the free
extension, under the MIT licence, and it is the whole free product** — not a
teaser for a paid one. Bugs, features and pull requests here are welcome the
same as in any MIT project.

The paid extension, RedLens Pro, is a separate closed-source extension that
depends on this one. It is not in this repository, and nothing here is
deliberately crippled to make it more attractive.

## What is free, and why the line is where it is

The rule the project follows: **free is for working with data, paid is for
saving money, avoiding incidents and governing.** So the daily loop — connect,
browse, edit, run, read results, export — is free, complete, and stays that way.

Two commitments that are enforced by tests in this repo, not just by intent:

- **Every safety feature is free.** Read-only mode, the production safeguard,
  transaction control and PII-safe masking. Charging for not leaking PII is not
  a position worth defending.
- **Connections are never counted or capped.** No limit, no tier, ever.

The whole tier map is a single file you can read: [`src/licensing/tiers.ts`](src/licensing/tiers.ts).
It lives here, in the open repository, on purpose — you should be able to see
exactly where the line is without installing anything.

## Getting set up

```bash
npm install
npm run typecheck
npm test
npm run build
```

That is the whole loop for most changes. Node 20 or later.

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host with the
extension loaded. Pick **Demo** in the connection wizard and you get a full
sample warehouse with no database and no AWS account.

### The heavier suites

```bash
npm run test:integration   # headless VS Code; activates the extension for real
npm run test:ui            # Playwright against the real webview pages
```

`test:integration` downloads a VS Code build the first time. The live database
tests are skipped unless `REDLENS_PG_HOST` points at a PostgreSQL instance —
`e2e/docker-compose.yml` starts a suitable one.

## What the tests are protecting

Several suites here exist because of a specific bug, and they read that way on
purpose. Before changing one, it is worth knowing what it caught:

- `tests/packaging.test.ts` — the `.vscodeignore` is an **allowlist**, because
  the denylist that preceded it silently shipped provisioning scripts and raw
  sources. Adding a re-include is a deliberate decision, and `npx @vscode/vsce ls`
  is the authoritative check.
- `tests/webviewSecurity.test.ts` — every webview declares a CSP. Escaping is a
  habit maintained by hand; the policy is what still holds the day someone
  forgets.
- `tests/commandSurface.test.ts` — the command palette is a shortcut, not a
  catalogue. It has a hard ceiling, and a command hidden from the palette must
  still be reachable some other way. It once caught a command that had become
  entirely unreachable.
- `tests/proBoundary.test.ts` — a padlocked feature must lead to an offer, never
  to a command that does not exist because RedLens Pro is not installed.

## Conventions

- **Commits**: conventional format, in English (`fix:`, `feat:`, `docs:`).
- **Pure core, thin shell**: logic goes in a module with no `vscode` import and
  gets unit tests; the command handler wires it up. Nearly every file in `src/`
  outside `commands/` follows this, and it is why the suite runs in seconds.
- **Fix the cause.** No flags that mask a failure — what is in the repo should
  work as it stands.
- **A bug fix starts with a failing test.** Repro first, then fix.

## Reporting a security issue

Please do not open a public issue. See [SECURITY.md](SECURITY.md).
