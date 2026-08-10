# Connect to Redshift (or try Demo)

RedLens connects to Amazon Redshift four ways — pick what fits:

- **Data API** — HTTPS + IAM via your `~/.aws` credentials. No VPN, no drivers; works with provisioned clusters and serverless workgroups.
- **Direct** — the Postgres wire protocol against a reachable cluster endpoint.
- **Direct via SSH bastion** — for private clusters behind a bastion host.
- **Demo** — a built-in sample warehouse (tickit). Zero credentials — the fastest way to see everything.

Open the **RedLens** view (the lens icon in the activity bar) and use
**Add a Connection**, or click the status bar item at the bottom-left.
