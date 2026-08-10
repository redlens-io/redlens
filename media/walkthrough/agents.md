# Use RedLens with AI agents (MCP)

RedLens ships an embedded **MCP server** that exposes your configured
connections to AI agents — GitHub Copilot agent mode, Claude, and any MCP
client inside VS Code — with **no manual setup**.

- The first time an agent uses it, VS Code asks you to trust the
  **RedLens Redshift** server.
- Agents can list schemas/tables/columns and run **read-only** queries.
- Writes are refused by both a SQL parser and an engine-level read-only
  transaction — your data is safe by default.

Ask your agent: *"Using the RedLens tools, list the tables in the tickit
schema and show the top events by sales."*
