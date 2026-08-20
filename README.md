# RedLens — SQL IDE & MCP for Amazon Redshift

**A Redshift-native SQL IDE for VS Code, with an MCP server built in.**

Connect four ways, browse your catalog, run SQL, read plans with warehouse-aware
warnings — and hand the same connections to Copilot or Claude without wiring up a
thing. Built for data engineers, analytics engineers and anyone who lives in
Redshift and would rather not live in a browser tab.

![RedLens in use: the warehouse in the explorer, a query in the SQL editor, results in the grid with a foreign key marked, an execution plan warning about a broadcast join and how to fix it, and the grid again with personal data masked by default](https://lensql.dev/img/listing/hero.gif)

---

## What it looks like

**The editor and the catalog** — completion from your live schema, and results
you can filter, chart, transpose and export without leaving the tab.

![The RedLens SQL editor with schema-aware completion](https://lensql.dev/img/listing/editor.png)

**Charts from any result, free** — pick a type, a label column and the values,
and the grid becomes a chart. Sorting, filtering, transposing, grouping, diffing
two runs and editing in place are all free too. There is no premium grid.

![The result grid switched to a bar chart: chart type, label column and value columns selectable above, with venue seats plotted per arena from demo data](https://lensql.dev/img/listing/charts.png)

**The Table Optimization Advisor** *(Pro)* — distribution skew, unsorted blocks,
stale statistics and AWS's own recommendations, each with the SQL that fixes it.

![Table Optimization Advisor showing skew, unsorted percentage and stale statistics with remedial SQL](https://lensql.dev/img/listing/table-advisor.png)

**Plans with warehouse-aware warnings** — the parts of a plan that cost you
money, named.

![An EXPLAIN plan annotated with warehouse-aware warnings](https://lensql.dev/img/listing/explain-plan.png)

**PII-safe mode** — columns that look like personal data are masked until you
ask, so a screen-share or a pairing session is not an incident.

![Result grid with an email column masked and marked PII](https://lensql.dev/img/listing/pii-safe-mode.png)

**Datashares, users, roles and policies in the tree** — and, per object, who can
do what. Column-level grants and RBAC roles included, which is where the other
clients stop.

![The RedLens explorer showing datashares, users and roles and security policies, beside a panel listing the grants on a table including a column-level grant to an RBAC role](https://lensql.dev/img/listing/governance.png)

**What the warehouse is costing you** *(Pro)* — CloudWatch metrics with the RPU
cost of the window you are looking at.

![CloudWatch metrics with RPU cost for the selected window](https://lensql.dev/img/listing/cost-metrics.png)

## Open source

**This extension is open source under the MIT licence.** Everything described
below as free is in this repository — you can read it, build it, fork it, and
use it commercially without asking anyone.

RedLens is open core. There is a second, paid extension —
**[RedLens Pro](https://marketplace.visualstudio.com/items?itemName=lensql.redlens-pro)** —
that adds warehouse-specific advice, the Redshift console, AI grounded in your
schema and governance administration. It is closed source and it is a separate
install.

Three things worth saying plainly, because open core has a reputation and it was
earned:

- **The free tier is the whole free product, not a demo.** Connecting, browsing,
  editing, running, reading results and the embedded MCP server are complete and
  stay that way.
- **Nothing that ships free ever moves to Pro.** New Pro features are new
  features, never features you already had.
- **Where the line falls is a file you can read**: [`src/licensing/tiers.ts`](src/licensing/tiers.ts).
  It lives in the open repository on purpose. You should not have to install
  anything to find out what you are getting.

Every safety feature is free and always will be — read-only mode, the production
safeguard, transaction control and PII-safe masking. Charging for not leaking
PII is not a position worth defending.

---

## Free and Pro

RedLens installs free, and **Free is a complete daily loop — not a demo.**

Unlimited connections of all four kinds, the schema explorer, the SQL editor with
metadata-driven autocomplete and linting, the **entire** result grid, query
history, saved queries, SQL notebooks, the EXPLAIN visualizer, the visual query
builder, CSV import, the governance tree, sessions and locks, the basic read-only
MCP tools, and **every safety feature**. Connections are never counted. History
is never capped.

**Pro is what saves money, prevents incidents and governs.**

| | Free | Pro |
|---|:---:|:---:|
| Connections — Data API · direct · SSH bastion · Demo | Unlimited | Unlimited |
| Schema explorer, external (Spectrum) schemas, table preview | ✓ | ✓ |
| SQL editor — metadata autocomplete, linting, cancel, transactions | ✓ | ✓ |
| Result grid — sort, filter, charts, heatmap, transpose, grouping, run comparison, inline edit, export | ✓ | ✓ |
| Query history · saved queries · SQL notebooks · visual query builder | ✓ | ✓ |
| EXPLAIN visualizer — `DS_BCAST`/`DS_DIST` warnings, DISTKEY/SORTKEY advice | ✓ | ✓ |
| CSV import · schema diagram · object scripting · mock data | ✓ | ✓ |
| Governance tree — datashares, users, roles, privileges, sessions, locks | ✓ | ✓ |
| Safety — read-only mode, production safeguard, PII-safe masking | ✓ | ✓ |
| MCP server — `list_*`, `execute_query` (read-only), `explain_query` | ✓ | ✓ |
| Performance Dashboard — CloudWatch metrics, RPU cost | — | ✓ |
| Table Advisor — skew, stale stats, AWS Advisor recommendations + SQL | — | ✓ |
| Query & Load Monitoring — WLM queueing, per-query cost, decoded COPY errors | — | ✓ |
| Cluster view — parameters, network, snapshots, maintenance, logging, limits, events | Properties only | All ten sections |
| Generated `aws` CLI for console actions · read-only IAM policy generator | — | ✓ |
| Compare Schemas · Compare Table Data · Schedule Query | — | ✓ |
| S3 UNLOAD / COPY wizards | — | ✓ |
| Effective Access · RLS & masking policies · user/role/datashare admin code-gen | — | ✓ |
| AI — NL→SQL, explain plan, optimize, fix last error, describe object, `@redlens` chat | — | ✓ |
| Advanced MCP tools — table health, query history, recommendations, write, UNLOAD | — | ✓ |

**Every install starts with 14 days of full Pro. No credit card. No account. No
sign-up.** The trial begins on first activation. When it ends nothing breaks —
the Pro features lock, everything else keeps working forever.

To start the trial, install
**[RedLens Pro](https://marketplace.visualstudio.com/items?itemName=lensql.redlens-pro)**
— it adds itself to this extension. There is nothing to buy first and nothing to
sign up for.

> **Our promise: nothing that ships Free ever moves to Pro.** New Pro features
> are new features, never features you already had.

### Price

- **Pro — $99 per person / year.** → **[Buy RedLens Pro](https://lensql.dev/buy)**
- **Team — $79 per seat / year**, minimum 5 seats. → **[Buy Team seats](https://lensql.dev/buy/team)**
- Enterprise — on request.

**Licences are bought outside VS Code and outside the Visual Studio Marketplace.**
You buy on the [RedLens site](https://lensql.dev/pricing), receive the key by
email, and paste it into VS Code with **`RedLens: Manage Licence`**. There is no
account to create and no RedLens server to talk to: keys are verified **offline**
against a public key embedded in the extension.

**Cancelling is a button**, in the [customer portal](https://lensql.dev/account) —
no email to us, no notice period, and you keep Pro until the end of the term you
paid for. Invoices, payment method, seats and machine activations live there too.

Two commitments that come with paying:

- **Refunds: 14 days, no questions asked** — on a purchase or a renewal.
- **If a licence lapses, nothing of yours is touched** — the Pro features lock
  and everything else keeps working forever. Connections, history, saved queries
  and notebooks are untouched, and Free never expires.

---

## Why RedLens

**Redshift-native, not Postgres-with-a-hat.** No driver to hunt down, no second
extension to install. Distribution and sort key advice, skew, WLM queues, RPU
cost, decoded COPY errors, datashares, RLS and masking, effective permissions —
the things a Redshift warehouse actually breaks on.

**The MCP server is built in.** Your connections are exposed to GitHub Copilot,
Claude and any MCP client inside VS Code, with **engine-level read-only
enforcement** — the guarantee lives in the query engine, not in a prompt. Zero
configuration; installing RedLens is the setup.

**PII is masked before results reach the model.** With PII-safe mode on, masking
happens on the way out of the engine, so a language model or MCP client never
sees the raw values.

**Nothing leaves your machine.** No account, no telemetry backend, no licence
server. AWS credentials stay in `~/.aws` or VS Code Secret Storage. RedLens works
inside a private VPC with no egress.

---

## Connect four ways

| Mode | What it needs | Good for |
|---|---|---|
| **Demo** | Nothing at all | Seeing the whole product in about ten seconds |
| **Redshift Data API** | IAM credentials from `~/.aws` | No network setup, no VPC access, no ports |
| **Direct (Postgres wire)** | Host, port, database, credentials | Publicly reachable or peered clusters |
| **Direct via SSH bastion** | The above plus a jump host | Private clusters in a VPC |

Profiles are saved; passwords and keys live in VS Code Secret Storage. For
cross-user query monitoring on a real cluster you will also want the
`SYS:MONITOR` role granted to the connecting user.

**Start with Demo mode.** No credentials, no cluster, no AWS account — a sample
warehouse loads instantly and every Free feature works against it.

---

## What you get

### Schema explorer
A lazy tree of schemas → tables and views → columns, including external
(Spectrum) schemas. One-click preview of a table's first rows, object scripting,
a schema diagram, search across objects and find-usages.

### SQL editor
Run a selection or a whole file with **Ctrl+Enter**, cancel a running query,
control transactions explicitly. Autocomplete is driven by live catalog metadata
— real schemas, tables and columns — plus Redshift keywords and functions.
Linting, snippets, saved queries and a searchable history come with it.

### The result grid — all of it, free
Sort, filter, chart, heatmap, transpose, group, pin a baseline and diff two runs
against each other, edit rows in place and commit, paste rows in, export. There
is no "premium grid".

### SQL notebooks and the visual query builder
Notebook cells for narrative analysis; a builder for when you would rather click
than type.

### EXPLAIN visualizer
The plan as a tree, with warehouse-aware warnings — `DS_BCAST` / `DS_DIST`
broadcasts, oversized scans — and concrete DISTKEY/SORTKEY advice. `EXPLAIN
ANALYZE` too.

### Embedded MCP server
Read-only tools registered automatically inside VS Code: list databases, schemas,
tables and columns, run a read-only query, explain a query. Read-only is enforced
by the engine. Point Copilot or Claude at your warehouse without writing a config
file.

### Safety, always free
Read-only mode. A production safeguard that makes you confirm before a write
against a cluster you have flagged as production. PII-safe masking. These are
free forever and, by design, cannot be moved to Pro.

### Performance Dashboard `Pro`
CloudWatch infrastructure metrics next to query activity, and the RPU cost of the
window you are looking at. Refreshes only when you ask it to — metric calls are
billed per request, and a panel that polls on a timer is a bill you did not
agree to.

### Table Advisor `Pro`
Distribution and sort key advice, skew, stale statistics — plus the AWS Advisor
recommendations with the SQL they recommend.

### Query & Load Monitoring `Pro`
WLM queueing, cost per query, and COPY errors decoded into something you can act
on.

### Cluster view `Pro`
The Redshift console's configuration in the sidebar: parameters, network,
snapshots, maintenance, logging, scheduled actions, limits, events and reserved
nodes. Read-only, and Properties is free. Parameters that differ from the engine
default are listed first — the console does not do that. RedLens never mutates
your cluster: for actions it **generates** the `aws` CLI for you to review and
run, and it will generate the minimal read-only IAM policy it needs, explaining
what breaks without each statement.

### Compare Schemas · Compare Table Data · Schedule Query `Pro`
Diff two schemas and get the migration DDL. Row-level diff between two tables.
Generate the EventBridge Scheduler CLI to run a query on a schedule.

### S3 UNLOAD / COPY wizards `Pro`
Guided UNLOAD with format, compression and partitioning; guided COPY with the IAM
role and the error handling COPY actually needs. Generated for review — never
executed behind your back.

### Governance `Pro`
Effective Access: why a user can do something, with transitive role resolution
and the exact path that grants it. RLS and masking policies. Generated user, role
and datashare SQL, always for review, never executed.

### AI `Pro`
Natural language to SQL, explain a plan, optimize a query, fix the last error,
describe an object — all grounded in your live catalog — plus the `@redlens` chat
participant. AI runs on **your** VS Code language model subscription; RedLens
ships no model and no API key.

---

## Requirements

- VS Code — see the **Version** field on this page for the minimum release.
- A workspace you trust: RedLens holds warehouse credentials and can open SSH
  tunnels, so it does not run in Restricted Mode.
- For **Data API** connections: AWS credentials in `~/.aws` with permission to
  call the Redshift Data API. RedLens can generate the minimal read-only IAM
  policy for you.
- For **direct** connections: network reachability to the cluster (optionally
  through an SSH bastion).
- For **Demo** mode: nothing.
- **AI features** use the VS Code language model API and therefore require an
  active Copilot (or equivalent) subscription. RedLens does not resell model
  access.

RedLens starts an **embedded MCP server as a separate local process** so MCP
clients inside VS Code can reach your connections. It communicates over stdio, is
registered only within VS Code, and stops with the extension.

---

## Security and privacy

- **No RedLens server.** No account, no sign-in, no callback. The extension never
  phones home to us.
- **Credentials stay local.** IAM credentials are read from `~/.aws`; passwords,
  SSH keys and licence keys live in VS Code Secret Storage.
- **Licence keys verify offline** against an Ed25519 public key embedded in the
  extension. RedLens works in an air-gapped VPC with no egress.
- **Read-only is enforced in the engine**, not in a prompt — that is what makes
  exposing your warehouse to a language model defensible.
- **PII-safe mode masks values before they leave the engine**, so MCP clients and
  language models never receive the raw data.
- **Your SQL, schema names, endpoints, results and errors are never transmitted**
  to RedLens.

Telemetry is **off by default**. If you turn it on, RedLens records only that the
extension activated and which of its own commands ran — never SQL, object names,
endpoints, database names, AWS account identifiers, error messages, row counts or
results. VS Code's own telemetry setting always wins: if that is off, RedLens
sends nothing regardless.

---

## FAQ

<details>
<summary><strong>What happens when the 14-day trial ends?</strong></summary>

Nothing breaks. The Pro features lock and everything in the Free column keeps
working, forever, with no limits and no nag screens. Your connections, history,
saved queries and notebooks are untouched.
</details>

<details>
<summary><strong>Does the Free tier expire, or cap anything?</strong></summary>

No, and no. Connections are never counted. History is never capped. Free is not a
trial with a longer fuse — it is the product.
</details>

<details>
<summary><strong>Do I need an account to try Pro?</strong></summary>

No. No account, no credit card, no email. The trial starts the first time the
extension activates.
</details>

<details>
<summary><strong>How do I buy, and where does the key come from?</strong></summary>

Buy it here — **[RedLens Pro, $99/year](https://lensql.dev/buy)** or
**[Team seats, $79/seat/year](https://lensql.dev/buy/team)**. Your receipt
arrives by email with an **Access purchase** button; the key is on the page it
opens, under *Benefit Grants*, and in your
[account](https://lensql.dev/account) at any time. Run
**`RedLens: Manage Licence`** in VS Code and paste it. Purchase happens outside
VS Code and outside the Marketplace, so nothing about it depends on the
Marketplace knowing you paid.
</details>

<details>
<summary><strong>Does it work offline, or inside a VPC with no internet egress?</strong></summary>

Yes. Licence verification is offline — the extension holds the public half of the
signing key. The only network traffic RedLens generates is to your own warehouse
and, for Data API and CloudWatch features, to AWS endpoints you already reach.
</details>

<details>
<summary><strong>What if I stop paying?</strong></summary>

The Pro features lock and you revert to the Free tier, which never expires and is
never capped. Nothing of yours is deleted: connections, history, saved queries
and notebooks are untouched, and your databases are never involved. Renewing
restores Pro immediately.
</details>

<details>
<summary><strong>Does RedLens send my data anywhere?</strong></summary>

No SQL, schema names, endpoints, results or errors ever leave your machine. See
**Security and privacy** above.
</details>

---

## Support

- Bugs and feature requests: the public issue tracker linked under **Resources**
  on this page.
- Security reports: see `SECURITY.md`. Please do not open a public issue for a
  security problem.
- Billing and licensing: the contact on your purchase receipt.

---

## Licence

This extension is open source under the [MIT licence](LICENSE.md). RedLens Pro
is a separate, commercial extension with its own end-user licence agreement.

Amazon Redshift, Amazon S3, AWS and CloudWatch are trademarks of Amazon.com, Inc.
or its affiliates. RedLens is an independent product and is not affiliated with,
endorsed by, or sponsored by Amazon Web Services.

---

