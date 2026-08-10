# Changelog

All notable changes to RedLens. This file renders on the **Changelog** tab of the
extension's Marketplace page.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
