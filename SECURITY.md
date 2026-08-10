# Security

RedLens connects to production data warehouses, holds credentials, and exposes a
database to AI agents. This page says what it does with that access, and how to
report a problem.

## Reporting a vulnerability

Open a **private** security advisory at
<https://github.com/redlens-io/redlens/security/advisories/new>, or email the
maintainer. Please do not open a public issue for a security problem.

Include what you did, what happened, and what you expected. A proof of concept
helps but is not required.

## What RedLens does with your data

**Your credentials.** Passwords and secrets are stored with VS Code's
[SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage),
which encrypts them with the operating system's credential store. They are never
written to `settings.json`, never logged, and never included in telemetry.

**Your queries and results.** They travel between your machine and your own
warehouse. RedLens has no server: nothing is proxied through the publisher, and
there is no account to create.

**AI agents.** The embedded MCP server exposes your connection to agents such as
GitHub Copilot and Claude Code. Three controls apply, in this order:

1. The SQL guard rejects anything that is not a read.
2. The statement is additionally wrapped in `BEGIN TRANSACTION READ ONLY`, so
   the warehouse itself refuses a write even if the guard were bypassed.
3. With PII-safe mode on, configured columns are masked **before** results leave
   the extension, so the agent never receives the raw values.

**The local bridge.** The MCP child process talks to the extension over a
loopback socket authenticated with a per-session secret, so another process on
your machine cannot borrow your warehouse session.

**Telemetry.** RedLens sends nothing today: no backend is configured. The
emitter that will send it exists and is constrained by an allowlist — the only
events are `activate` (no fields) and `command` (one field: a command id drawn
from the extension's own declared list). There is no free-text field anywhere in
the payload.

It will never include SQL text, schema/table/column names, connection endpoints,
database names, AWS account identifiers, **error messages**, row counts or query
results. Error messages are called out because they are the realistic leak in a
database tool: a Redshift error carries table names, and sometimes values, inside
the string.

It honours VS Code's `telemetry.telemetryLevel`, and `redlens.telemetry.enabled`
can only turn it further off — never back on against your global preference.

## Connection security

- **TLS certificates are verified** by default. A connection that cannot be
  verified fails rather than silently downgrading to "encrypted but
  unauthenticated". You can opt out per connection with `sslInsecure` when you
  have consciously decided a network is trustworthy.
- **SSH bastion host keys are verified** on a trust-on-first-use basis, like
  OpenSSH. The first connection shows the fingerprint for you to confirm. If a
  remembered key later changes, RedLens refuses to connect and does not offer to
  continue — a changed key means either a rebuilt bastion or an interception, and
  only you can tell those apart.

## Write safety

Generated SQL is never executed for you. Every scripting feature opens an editor
for you to review and run yourself. Separately, a connection can be marked
read-only or as production, and inline edits build reviewable DML rather than
issuing statements directly.

## Extension packaging

The published `.vsix` contains only the runtime bundles, the icon, the
walkthrough content and the snippets. Source, tests, build tooling, source maps
and operational scripts are excluded by an allowlist, verified with
`vsce ls` and enforced by a test in the repository.
