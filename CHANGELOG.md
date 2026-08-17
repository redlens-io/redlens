# Changelog

All notable changes to RedLens. This file renders on the **Changelog** tab of the
extension's Marketplace page.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.6] — 2026-08-17

**Adds the missing way to start the Pro trial.** This page described the 14-day
trial and the Free/Pro split in detail, and then never linked to the extension
that starts it — the only clickable path led to the checkout, which skips a free
trial that needs no card and no account. Both places that mention RedLens Pro now
link to it.

Documentation only. No functional changes.

## [1.0.5] — 2026-08-14

Corrects where your licence key actually is. Your receipt arrives by email with
an **Access purchase** button, and the key is on the page it opens, under
*Benefit Grants* — it is not inside the email itself. It is also in your account
at lensql.dev/account at any time. Earlier wording sent buyers hunting through
their inbox for something that was never sent there.

## [1.0.4] — 2026-08-14

The store page now shows the product before describing it: a short looping
animation at the top — connect, query, read the results, read the plan, and the
grid with personal data masked by default — plus a new image for the governance
tree beside the grants on a table, including column-level ones and RBAC roles.

Nothing in the extension itself changed.

## [1.0.3] — 2026-08-14

### Buying, and everything around it

- **Buy a licence** is an action on every padlock and in
  `RedLens: Manage Licence`, and both listings link straight to checkout. Your
  key arrives by email; paste it with `RedLens: Manage Licence`.
- **Cancelling is a button** in the customer portal, reachable from
  `RedLens: Manage Licence` and from the pricing page — along with invoices,
  payment method, seats and machine activations. No notice period, and you keep
  Pro until the end of the term you paid for.
- **Team is $79 per seat per year**, minimum five seats. Pro is $99 per person
  per year. The prices shown here are the prices charged at checkout.

### The trial

- **The days remaining are in the status bar**, so you can see them without
  going looking. The badge turns amber for the last three days and opens the
  licence screen when clicked.
- **The count follows the calendar** while the editor stays open, and shows the
  date the trial ends: *"Pro trial — 12 days left (until Aug 26)"*.
- **When the trial ends you are told once**, with what still works, instead of
  finding out from a padlock.

### Links

- Every link in the extension, the listing images and the licence terms point at
  `lensql.dev`, served over HTTPS with no intermediate hop.

## [1.0.0] — 2026-08-12

First public release. The open extension is complete and MIT-licensed: four ways
to connect, the catalog explorer, the SQL editor with schema-aware completion,
the results grid with filtering, charts, transpose and export, plan reading, the
governance tree, and the MCP server that hands your connections to Copilot or
Claude.

**Every safety feature is here and always will be** — read-only mode, the
production safeguard, transaction control and PII-safe masking are not paid
features and never become paid features.

Optional paid features live in a separate extension, **RedLens Pro**, so this
package stays open and complete on its own. What is behind the padlock and why is
listed on the pricing page; the tier map is public.

## [0.9.0] — 2026-07-27

Feature-complete and validated — M1 through M10, 595 automated tests, an
end-to-end validation session against a real Redshift Serverless workgroup, and
a full manual pass. Not yet on the Marketplace: version 1.0.0 is reserved for
the release where a licence can actually be purchased. What remains is in the
checklist at the end of `README.md`.

### Added — Redshift console and CloudWatch

- **Performance Dashboard is now hybrid.** A row of infrastructure cards from
  Amazon CloudWatch sits above the query detail: health, CPU, disk, connections,
  maintenance and WLM queues on provisioned clusters; RPU capacity, RPU-seconds
  with an estimated cost, running and queued queries, connections, duration and
  storage on Serverless. Each card carries a sparkline, with a `1h · 6h · 24h ·
  7d` range selector.
  Metric requests are billed per request, so the whole panel is fetched in a
  single call and **only when you ask for it** — never on a timer.
- **The dashboard reads live system views.** Until now it only ever showed sample
  data; it now reads `SYS_QUERY_HISTORY` and `SVV_TABLE_INFO` from the connected
  warehouse.
- **Cluster view** — a third sidebar view with the Redshift console's
  configuration in ten read-only sections: properties, parameters, network and
  security, snapshots and recovery points, maintenance, logging and audit,
  scheduled actions, usage limits, events, and reservations. Works for both
  provisioned clusters and Serverless workgroups.
  Parameters that differ from the engine default are listed **first**, which the
  AWS console does not do.
- **AWS Advisor recommendations** inside the Table Advisor, including the SQL AWS
  itself recommends, ordered by impact.
- **Generated `aws` CLI for console actions** — pause, resume, reboot, resize,
  snapshot and parameter changes on provisioned clusters; RPU capacity,
  snapshots, recovery-point conversion, config parameters and usage limits on
  Serverless. Each comes with what it interrupts, whether it can be undone, and
  how to verify it afterwards. RedLens never calls a mutating API.
- **Read-only IAM policy generator** — the exact permissions RedLens needs, with
  a note on what stops working without each statement.

### Added — Free and Pro

- **A Free/Pro split, with a 14-day trial of everything** that starts on first
  activation. No card, no account, no sign-up.
- Licence keys are verified **offline** against a public key embedded in the
  extension. No server, no account, and it works inside a VPC with no egress.
  Fourteen days of grace after expiry, so a lapsed renewal never locks you out
  mid-flight.
- Pro features stay **visible** with a padlock and a description of what they do,
  rather than disappearing.

### Changed

- Telemetry now defaults to **off**. There is no collection backend, so leaving
  it on advertised an online service that did not exist.
- Support and pricing links moved out of the source into one place, so they can
  never again point at a repository users cannot open.

### Fixed

Three bugs that only appeared against a real Redshift warehouse, found in an
ephemeral validation session:

- Three of the eight known Serverless parameter defaults were wrong, which would
  have flagged three untouched parameters as changed on every new workgroup.
- Serverless returns IAM roles as a wrapped string rather than a bare ARN, so the
  role name rendered with a stray closing parenthesis.
- The `QueriesFailed` metric does not exist per workgroup; the account-wide
  equivalent would have reported other people's failures as yours. The card was
  replaced with charged compute seconds, and failures are read from the query
  history instead.
