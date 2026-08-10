# mcp-server (placeholder — Fase 2)

The embedded stdio MCP server lands here in Fase 2, per PLAN §5.4:

- Bundled separately by esbuild to `dist/mcp-server.js`.
- SDK decision at Fase 2 start: `@modelcontextprotocol/server` (v2 layout,
  `serveStdio` + `zod/v4`) if stable, otherwise `@modelcontextprotocol/sdk`
  v1.29.x — SDK surface isolated behind an adapter module either way.
- Reuses the extension's live connections/auth through a local socket bridge
  (vscode-mssql pattern); never owns credentials itself.
- Free tools: list_connections/databases/schemas/tables/columns,
  execute_query (engine-enforced read-only), explain_query.
- stdio rule: log via console.error only — stdout is the JSON-RPC stream.

The `mcpServerDefinitionProviders` contribution and a stub provider (returns
no servers) are already wired in `src/extension.ts` so the registration path
is validated from day 1.
