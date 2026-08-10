# Third-party notices

RedLens bundles the following open-source components. Each remains under its own
licence; nothing here changes the terms of `LICENSE.md`, which is the MIT
licence covering RedLens itself.

Bundled into `dist/` at build time by esbuild, so they ship inside the extension:

| Component | Purpose in RedLens | Licence |
|---|---|---|
| [`pg`](https://github.com/brianc/node-postgres) | Postgres wire protocol — the `direct` and `direct+ssh` connection types | MIT |
| [`ssh2`](https://github.com/mscdex/ssh2) | The SSH tunnel for reaching clusters through a bastion | MIT |
| [`sql-formatter`](https://github.com/sql-formatter-org/sql-formatter) | SQL formatting, Redshift dialect | MIT |
| [`zod`](https://github.com/colinhacks/zod) | Runtime validation of MCP tool inputs | MIT |
| [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) | The embedded MCP server | MIT |
| [`@aws-sdk/client-redshift-data`](https://github.com/aws/aws-sdk-js-v3) | Redshift Data API — the `data-api` connection type | Apache-2.0 |
| [`@aws-sdk/client-cloudwatch`](https://github.com/aws/aws-sdk-js-v3) | Infrastructure metrics on the Performance Dashboard | Apache-2.0 |
| [`@aws-sdk/client-redshift`](https://github.com/aws/aws-sdk-js-v3) | Provisioned-cluster configuration in the Cluster view | Apache-2.0 |
| [`@aws-sdk/client-redshift-serverless`](https://github.com/aws/aws-sdk-js-v3) | Serverless workgroup and namespace configuration | Apache-2.0 |

Each package's full licence text ships inside its own distribution and is
available at the repository linked above.

## What RedLens does not bundle

- **No language model.** The AI features call the Visual Studio Code language
  model API, which uses the subscription already configured in your editor.
  RedLens ships no model, no API key and no inference code.
- **No telemetry SDK.** Telemetry, when enabled, goes through VS Code's own
  `createTelemetryLogger`.
- **No cryptography library.** Licence verification uses Node's built-in
  `crypto`.

## Trademarks

Amazon Redshift, Amazon S3, AWS and Amazon CloudWatch are trademarks of
Amazon.com, Inc. or its affiliates. Visual Studio Code and GitHub Copilot are
trademarks of Microsoft Corporation. RedLens is an independent product, not
affiliated with, endorsed by or sponsored by any of them.
