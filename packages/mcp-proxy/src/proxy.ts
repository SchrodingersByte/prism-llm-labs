/**
 * PrismMcpProxy — transparent process-level MCP proxy.
 *
 * Architecture:
 *   AI Client (Claude Desktop, Cline, etc.)
 *       ↕  MCP / stdio
 *   PrismMcpProxy                ← this package
 *       ↕  MCP / stdio
 *   Target MCP server (any server, unmodified)
 *
 * The proxy:
 *  1. Spawns the target as a child process via StdioClientTransport
 *  2. Discovers what capabilities the target declares (tools / resources / prompts)
 *  3. Creates a proxy Server that re-advertises those same capabilities
 *  4. Intercepts every tool call, resource read, and prompt get:
 *       – checks session budget + loop limits (pre-call)
 *       – forwards the request to the target
 *       – measures wall-clock latency
 *       – ships a fire-and-forget McpEvent to /api/mcp/ingest
 *       – returns the target's response unchanged
 *  5. Connects the proxy Server to the caller via StdioServerTransport
 */

import { Server }               from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client }               from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import { McpEventTracker, SessionBudgetChecker, lookupToolCost } from "@prism-llm-labs/mcp-sdk";
import type { McpPrimitiveType } from "@prism-llm-labs/mcp-sdk";
import type { ProxyOptions } from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_REDACT_KEYS = ["password", "token", "key", "secret", "api_key", "authorization"];

function redactObject(obj: unknown, keys: string[]): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactObject(v, keys));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = keys.some((r) => k.toLowerCase().includes(r.toLowerCase()))
      ? "[REDACTED]"
      : redactObject(v, keys);
  }
  return out;
}

function safeJson(val: unknown, redactKeys: string[], maxLen: number): string {
  try {
    const s = JSON.stringify(redactObject(val, redactKeys));
    return s.length <= maxLen ? s : s.slice(0, maxLen) + "…";
  } catch {
    return "[unserializable]";
  }
}

function orgFromKey(key: string): string {
  const parts = key.split("_");
  return parts.length >= 4 ? (parts[2] ?? "") : "";
}

function ts(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 23);
}

// ── Core class ────────────────────────────────────────────────────────────────

export class PrismMcpProxy {
  private readonly opts: {
    prismKey:              string;
    serverName:            string;
    project:               string;
    team:                  string;
    environment:           string;
    sessionId:             string;
    sessionBudgetUsd?:     number;
    maxToolCallsPerSession?: number;
    captureInputs:         boolean;
    captureOutputs:        boolean;
    costOverrides:         Record<string, number>;
  };
  private readonly tracker:    McpEventTracker;
  private readonly budget:     SessionBudgetChecker;
  private readonly redactKeys: string[];

  constructor(
    private readonly targetCommand: string,
    private readonly targetArgs:    string[],
    options: ProxyOptions = {},
  ) {
    const key = options.prismKey ?? process.env["PRISM_API_KEY"] ?? "";
    if (!key) {
      process.stderr.write("[prism-proxy] PRISM_API_KEY not set — telemetry disabled\n");
    }

    this.opts = {
      prismKey:              key,
      serverName:            options.serverName     ?? targetCommand.split(/[\\/]/).pop() ?? "mcp-server",
      project:               options.project        ?? process.env["PRISM_PROJECT"]     ?? "",
      team:                  options.team           ?? process.env["PRISM_TEAM"]        ?? "",
      environment:           options.environment    ?? process.env["PRISM_ENVIRONMENT"] ?? "production",
      sessionId:             options.sessionId      ?? crypto.randomUUID(),
      sessionBudgetUsd:      options.sessionBudgetUsd,
      maxToolCallsPerSession: options.maxToolCallsPerSession,
      captureInputs:         options.captureInputs  ?? false,
      captureOutputs:        options.captureOutputs ?? false,
      costOverrides:         options.costOverrides  ?? {},
    };

    this.redactKeys = options.redactKeys ?? DEFAULT_REDACT_KEYS;
    this.tracker    = new McpEventTracker(key, this.opts.serverName, options.ingestUrl);
    this.budget     = new SessionBudgetChecker(orgFromKey(key));
  }

  /**
   * Start the proxy. Blocks until the AI client disconnects.
   * Spawn the target server, connect both transports, then wait.
   */
  async run(): Promise<void> {
    // ── 1. Connect to target server ──────────────────────────────────────────
    const targetTransport = new StdioClientTransport({
      command: this.targetCommand,
      args:    this.targetArgs,
      stderr:  "pipe",   // don't let target's stderr pollute our stdout
    });

    const targetClient = new Client(
      { name: "prism-proxy-client", version: "1.0.0" },
      { capabilities: {} },
    );

    await targetClient.connect(targetTransport);

    const caps: ServerCapabilities = targetClient.getServerCapabilities() ?? {};
    const hasTools     = !!caps.tools;
    const hasResources = !!caps.resources;
    const hasPrompts   = !!caps.prompts;

    // ── 2. Build proxy server ────────────────────────────────────────────────
    const proxyCaps: ServerCapabilities = {};
    if (hasTools)     proxyCaps.tools     = {};
    if (hasResources) proxyCaps.resources = { listChanged: false, subscribe: false };
    if (hasPrompts)   proxyCaps.prompts   = { listChanged: false };

    const proxyServer = new Server(
      { name: this.opts.serverName, version: "1.0.0" },
      { capabilities: proxyCaps },
    );

    // ── 3. Register handlers ─────────────────────────────────────────────────

    if (hasTools) {
      proxyServer.setRequestHandler(
        ListToolsRequestSchema,
        () => targetClient.listTools(),
      );

      proxyServer.setRequestHandler(
        CallToolRequestSchema,
        (req) => this._handleToolCall(req.params.name, req.params.arguments ?? {}, targetClient),
      );
    }

    if (hasResources) {
      proxyServer.setRequestHandler(
        ListResourcesRequestSchema,
        () => targetClient.listResources(),
      );

      // Resource templates — not all servers support this; ignore if unavailable
      proxyServer.setRequestHandler(
        ListResourceTemplatesRequestSchema,
        async () => {
          try {
            return await targetClient.listResourceTemplates();
          } catch {
            return { resourceTemplates: [] };
          }
        },
      );

      proxyServer.setRequestHandler(
        ReadResourceRequestSchema,
        (req) => this._handleResourceRead(req.params.uri, targetClient),
      );
    }

    if (hasPrompts) {
      proxyServer.setRequestHandler(
        ListPromptsRequestSchema,
        () => targetClient.listPrompts(),
      );

      proxyServer.setRequestHandler(
        GetPromptRequestSchema,
        (req) => this._handlePromptGet(
          req.params.name,
          req.params.arguments as Record<string, string> | undefined,
          targetClient,
        ),
      );
    }

    // ── 4. Connect proxy to the AI client via stdio ──────────────────────────
    const proxyTransport = new StdioServerTransport();
    await proxyServer.connect(proxyTransport);

    // ── 5. Wait for disconnect ───────────────────────────────────────────────
    await new Promise<void>((resolve) => {
      proxyTransport.onclose = resolve;
    });

    try { await targetClient.close(); } catch { /* ignore */ }
  }

  // ── Private: tool call intercept ──────────────────────────────────────────

  private async _handleToolCall(
    name:   string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args:   Record<string, any>,
    target: Client,
  ) {
    await this._checkBudget();

    const estimatedCost = lookupToolCost(name, this.opts.costOverrides);
    const start         = Date.now();
    const eventTags: Record<string, string> = {};

    if (this.opts.captureInputs) {
      eventTags["tool_input"] = safeJson(args, this.redactKeys, 1000);
    }

    let status:   "ok" | "error" | "timeout" = "ok";
    let errorMsg  = "";

    let result: Awaited<ReturnType<Client["callTool"]>>;
    try {
      result = await target.callTool({ name, arguments: args });
    } catch (err) {
      status   = "error";
      errorMsg = err instanceof Error ? err.message : String(err);
      this._ship("tool", name, Date.now() - start, estimatedCost, "estimated", status, errorMsg, eventTags);
      throw err;
    }

    const latencyMs = Date.now() - start;

    // MCP tool errors are returned in the result (not thrown) with isError=true
    if (result.isError) {
      status = "error";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = result.content as any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const errBlock = Array.isArray(content) ? content.find((c: any) => c?.type === "text") : null;
      errorMsg = (errBlock as { text?: string } | null)?.text ?? "Tool returned error";
    }

    if (this.opts.captureOutputs) {
      eventTags["tool_output"] = safeJson(result.content, this.redactKeys, 1000);
    }

    this._ship("tool", name, latencyMs, estimatedCost, "estimated", status, errorMsg, eventTags);
    return result;
  }

  // ── Private: resource read intercept ─────────────────────────────────────

  private async _handleResourceRead(uri: string, target: Client) {
    await this._checkBudget();

    const start = Date.now();
    let status: "ok" | "error" | "timeout" = "ok";
    let errorMsg = "";

    let result: Awaited<ReturnType<Client["readResource"]>>;
    try {
      result = await target.readResource({ uri });
    } catch (err) {
      status   = "error";
      errorMsg = err instanceof Error ? err.message : String(err);
      this._ship("resource", uri, Date.now() - start, 0, "estimated", status, errorMsg, {});
      throw err;
    }

    this._ship("resource", uri, Date.now() - start, 0, "estimated", status, errorMsg, {});
    return result;
  }

  // ── Private: prompt get intercept ────────────────────────────────────────

  private async _handlePromptGet(
    name:   string,
    args:   Record<string, string> | undefined,
    target: Client,
  ) {
    await this._checkBudget();

    const start = Date.now();
    let status: "ok" | "error" | "timeout" = "ok";
    let errorMsg = "";

    let result: Awaited<ReturnType<Client["getPrompt"]>>;
    try {
      result = await target.getPrompt({ name, arguments: args });
    } catch (err) {
      status   = "error";
      errorMsg = err instanceof Error ? err.message : String(err);
      this._ship("prompt", name, Date.now() - start, 0, "estimated", status, errorMsg, {});
      throw err;
    }

    this._ship("prompt", name, Date.now() - start, 0, "estimated", status, errorMsg, {});
    return result;
  }

  // ── Private: shared helpers ───────────────────────────────────────────────

  private async _checkBudget(): Promise<void> {
    await this.budget.checkOrThrow(
      this.opts.sessionId,
      this.opts.sessionBudgetUsd,
      this.opts.maxToolCallsPerSession,
    );
  }

  private _ship(
    primitiveType: McpPrimitiveType,
    toolName:      string,
    latencyMs:     number,
    costUsd:       number,
    costStatus:    "estimated" | "actual",
    status:        "ok" | "error" | "timeout",
    errorMessage:  string,
    tags:          Record<string, string>,
  ): void {
    this.tracker.capture({
      timestamp:            ts(),
      session_id:           this.opts.sessionId,
      project_id:           this.opts.project,
      team_id:              this.opts.team,
      user_id:              "",
      environment:          this.opts.environment,
      tool_name:            toolName,
      downstream_resource:  "",
      execution_latency_ms: latencyMs,
      tool_cost_usd:        costUsd,
      cost_status:          costStatus,
      status,
      error_message:        errorMessage,
      llm_request_id:       "",
      primitive_type:       primitiveType,
      tags,
    }).catch(() => {});
  }
}
