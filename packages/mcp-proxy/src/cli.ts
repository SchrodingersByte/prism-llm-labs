/**
 * mcp-proxy CLI
 *
 * Usage (everything after -- is the target command):
 *   mcp-proxy [options] -- <command> [args...]
 *
 * Examples:
 *   PRISM_API_KEY=prism_live_... mcp-proxy -- npx @modelcontextprotocol/server-filesystem /path
 *   mcp-proxy --prism-key prism_live_... -- node my-mcp-server.js
 *
 * Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "filesystem": {
 *         "command": "npx",
 *         "args": ["@prism-llm-labs/mcp-proxy", "--", "npx", "@modelcontextprotocol/server-filesystem", "/path"],
 *         "env": { "PRISM_API_KEY": "prism_live_..." }
 *       }
 *     }
 *   }
 *
 * Options:
 *   --prism-key <key>          Prism API key (default: $PRISM_API_KEY)
 *   --server-name <name>       Name shown in dashboard (default: target command basename)
 *   --project <id>             Project ID for attribution
 *   --team <id>                Team attribution tag
 *   --environment <env>        production|staging|development (default: production)
 *   --session-id <id>          Explicit session ID (default: auto-generated UUID)
 *   --session-budget <usd>     Session budget in USD (e.g. 0.10)
 *   --max-tool-calls <n>       Max tool/resource/prompt calls per session
 *   --capture-inputs           Log call arguments to tags (opt-in, redacted)
 *   --capture-outputs          Log call results to tags (opt-in, redacted)
 *   --ingest-url <url>         Override Prism ingest URL (for self-hosted)
 *   --cost <tool=usd,...>      Per-tool cost overrides, e.g. "run_bash=0.002"
 */

import { PrismMcpProxy } from "./proxy.js";
import type { ProxyOptions } from "./types.js";

function usage(): void {
  process.stderr.write(
    "Usage: mcp-proxy [options] -- <command> [args...]\n" +
    "\nOptions:\n" +
    "  --prism-key <key>          Prism API key (default: $PRISM_API_KEY)\n" +
    "  --server-name <name>       Name shown in dashboard\n" +
    "  --project <id>             Project ID for attribution\n" +
    "  --team <id>                Team attribution tag\n" +
    "  --environment <env>        production|staging|development\n" +
    "  --session-id <id>          Explicit session ID\n" +
    "  --session-budget <usd>     Session budget in USD\n" +
    "  --max-tool-calls <n>       Max calls per session\n" +
    "  --capture-inputs           Log call arguments to tags\n" +
    "  --capture-outputs          Log call results to tags\n" +
    "  --ingest-url <url>         Override Prism ingest URL\n" +
    "  --cost <tool=usd,...>      Per-tool cost overrides\n" +
    "\nExample:\n" +
    "  mcp-proxy -- npx @modelcontextprotocol/server-filesystem /path/to/dir\n",
  );
}

function parseArgs(argv: string[]): { target: string[]; opts: ProxyOptions } | null {
  const args = argv.slice(2); // strip node + script path
  const opts: ProxyOptions = {};
  let i = 0;

  // Find -- separator
  const dashDash = args.indexOf("--");

  if (dashDash === -1) {
    process.stderr.write("[mcp-proxy] Error: missing -- separator before target command\n");
    return null;
  }

  const target = args.slice(dashDash + 1);
  if (target.length === 0) {
    process.stderr.write("[mcp-proxy] Error: no target command after --\n");
    return null;
  }

  // Parse options before --
  const optArgs = args.slice(0, dashDash);
  while (i < optArgs.length) {
    const flag = optArgs[i]!;
    switch (flag) {
      case "--prism-key":
        opts.prismKey = optArgs[++i];
        break;
      case "--server-name":
        opts.serverName = optArgs[++i];
        break;
      case "--project":
        opts.project = optArgs[++i];
        break;
      case "--team":
        opts.team = optArgs[++i];
        break;
      case "--environment":
        opts.environment = optArgs[++i];
        break;
      case "--session-id":
        opts.sessionId = optArgs[++i];
        break;
      case "--session-budget": {
        const budget = parseFloat(optArgs[++i] ?? "");
        if (!isNaN(budget)) opts.sessionBudgetUsd = budget;
        break;
      }
      case "--max-tool-calls": {
        const max = parseInt(optArgs[++i] ?? "", 10);
        if (!isNaN(max)) opts.maxToolCallsPerSession = max;
        break;
      }
      case "--capture-inputs":
        opts.captureInputs = true;
        break;
      case "--capture-outputs":
        opts.captureOutputs = true;
        break;
      case "--ingest-url":
        opts.ingestUrl = optArgs[++i];
        break;
      case "--cost": {
        const overrides: Record<string, number> = {};
        const pairs = (optArgs[++i] ?? "").split(",");
        for (const pair of pairs) {
          const [tool, cost] = pair.split("=");
          if (tool && cost) {
            const usd = parseFloat(cost);
            if (!isNaN(usd)) overrides[tool] = usd;
          }
        }
        opts.costOverrides = overrides;
        break;
      }
      case "--help":
      case "-h":
        usage();
        process.exit(0);
        break;
      default:
        process.stderr.write(`[mcp-proxy] Unknown flag: ${flag}\n`);
        return null;
    }
    i++;
  }

  return { target, opts };
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  if (!parsed) {
    usage();
    process.exit(1);
  }

  const [targetCommand, ...targetArgs] = parsed.target as [string, ...string[]];
  const proxy = new PrismMcpProxy(targetCommand, targetArgs, parsed.opts);

  // Graceful shutdown on SIGINT / SIGTERM
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => process.exit(0));
  }

  try {
    await proxy.run();
  } catch (err) {
    process.stderr.write(`[mcp-proxy] Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

main();
