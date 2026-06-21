# @prism-llm-labs/mcp-proxy

A **zero-code MCP proxy** for [Prism](https://useprism.dev) observability. Wrap *any*
[Model Context Protocol](https://modelcontextprotocol.io) server — including ones you don't own,
like the official `@modelcontextprotocol/server-*` packages or those in Claude Desktop — and get
per-tool cost, latency, session budgets, and loop detection with **no changes to the server**.

It speaks stdio MCP on both sides and instruments the traffic in between using
[`@prism-llm-labs/mcp-sdk`](../mcp-sdk).

```bash
npm install -g @prism-llm-labs/mcp-proxy
# or run on demand with npx (see Claude Desktop below)
```

## Usage

Everything after `--` is the target server command:

```bash
PRISM_API_KEY=prism_live_... mcp-proxy -- npx @modelcontextprotocol/server-filesystem /path
mcp-proxy --prism-key prism_live_... --session-budget 0.10 -- node my-mcp-server.js
```

## Claude Desktop

Point an existing server at the proxy in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@prism-llm-labs/mcp-proxy", "--", "npx", "@modelcontextprotocol/server-filesystem", "/path"],
      "env": { "PRISM_API_KEY": "prism_live_..." }
    }
  }
}
```

## Options

| Flag | Description |
|---|---|
| `--prism-key <key>` | Prism API key (default `$PRISM_API_KEY`) |
| `--server-name <name>` | Name shown in the dashboard (default: target command basename) |
| `--project <id>` / `--team <id>` | Attribution |
| `--environment <env>` | `production` \| `staging` \| `development` (default `production`) |
| `--session-id <id>` | Explicit session ID (default: auto UUID) |
| `--session-budget <usd>` | Hard session budget, e.g. `0.10` |
| `--max-tool-calls <n>` | Loop guard — max calls per session |
| `--capture-inputs` / `--capture-outputs` | Opt-in I/O capture (redacted) |
| `--cost <tool=usd,...>` | Per-tool cost overrides, e.g. `run_bash=0.002` |
| `--ingest-url <url>` | Override the Prism ingest URL (self-hosted) |

When the session budget or tool-call limit is exceeded, the proxy stops the call and surfaces it
in the dashboard. Telemetry is fire-and-forget — the proxied server keeps working even if Prism
is unreachable.

## Requirements

Node ≥ 18 · `@modelcontextprotocol/sdk >= 1.0.0` (peer).
