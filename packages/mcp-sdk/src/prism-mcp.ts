/**
 * PrismMCP — instruments any MCP Server with full observability:
 *   - tools/call   → wrapToolCall() / patchHandler()
 *   - resources/read → wrapResourceRead() / patchResourceHandler()
 *   - prompts/get  → wrapPromptGet() / patchPromptHandler()
 *   - sampling/createMessage → wrapSamplingHandler()
 *
 * Features:
 *   - Session budget circuit breaker (throws before execution if over budget)
 *   - Tool loop detection (throws if max_tool_calls_per_session exceeded)
 *   - Opt-in I/O capture (captureInputs / captureOutputs)
 *   - Streaming tool latency: correctly measures time-to-stream-end, not first-chunk
 */

import type { McpPrimitiveType, PrismMcpOptions } from "./types";
import { McpEventTracker }     from "./tracker";
import { SessionBudgetChecker } from "./budget";
import { lookupToolCost }      from "./pricing";

// ── Private helpers ────────────────────────────────────────────────────────────

function orgFromKey(key: string): string {
  const parts = key.split("_");
  return parts.length >= 4 ? (parts[2] ?? "") : "";
}

const DEFAULT_REDACT_KEYS = ["password", "token", "key", "secret", "api_key", "authorization"];

function redactObject(
  obj: unknown,
  redactKeys: string[],
): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactObject(v, redactKeys));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = redactKeys.some((r) => k.toLowerCase().includes(r.toLowerCase()))
      ? "[REDACTED]"
      : redactObject(v, redactKeys);
  }
  return out;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

function safeJson(val: unknown, redactKeys: string[], maxLen: number): string {
  try {
    return truncate(JSON.stringify(redactObject(val, redactKeys)), maxLen);
  } catch {
    return "[unserializable]";
  }
}

// ── Streaming proxy (Epic 6) ───────────────────────────────────────────────────

function isAsyncIterable(val: unknown): val is AsyncIterable<unknown> {
  return val != null &&
    typeof (val as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function";
}

/**
 * Wraps an async iterable so that `onEnd` is called with the total elapsed ms
 * when the stream is fully consumed or throws. All values are forwarded unchanged.
 */
async function* proxyAsyncIterable<T>(
  source: AsyncIterable<T>,
  start: number,
  onEnd: (latencyMs: number, threw: boolean) => void,
): AsyncGenerator<T> {
  let threw = false;
  try {
    for await (const value of source) {
      yield value;
    }
  } catch (err) {
    threw = true;
    throw err;
  } finally {
    onEnd(Date.now() - start, threw);
  }
}

// ── WrapContext — passed to the fn() callback for actual cost self-reporting ──

export class WrapContext {
  /** @internal - read by _wrap() after fn() completes */
  _actualCostUsd:      number | null = null;
  /** @internal */
  _downstreamResource: string | null = null;

  /**
   * Override the catalog-estimated tool cost with the real billing figure.
   * Call this inside your tool handler when you have access to actual cost data
   * (e.g. from AWS SDK response metadata, a billing header, or a usage API).
   *
   * @example
   * await prismMcp.wrapToolCall("invoke_lambda", async (ctx) => {
   *   const res = await lambda.invoke({ FunctionName: "fn", Payload: payload });
   *   const billedMs = res.$metadata.httpHeaders?.["x-amz-billed-duration-ms"] ?? "0";
   *   ctx.reportActualCost(parseInt(billedMs) * 0.000016667 / 1000);
   *   return res;
   * });
   */
  reportActualCost(usd: number): void {
    this._actualCostUsd = usd;
  }

  /**
   * Set the downstream resource identifier for this call.
   * Use this when the resource name is resolved inside the handler (e.g. after
   * looking up which Pinecone index to query).
   *
   * Convention:
   *   - Pinecone: "pinecone:<index-name>"  e.g. "pinecone:product-embeddings"
   *   - Qdrant:   "qdrant:<collection>"    e.g. "qdrant:support-docs"
   *   - Generic:  just the provider name   e.g. "weaviate", "redis"
   *
   * Overrides the `downstreamResource` option passed to wrapToolCall().
   *
   * @example
   * await prismMcp.wrapToolCall("vector_search", async (ctx) => {
   *   const index = await resolveIndex(query);
   *   ctx.setDownstreamResource(`pinecone:${index}`);
   *   return pinecone.query({ index, vector });
   * });
   */
  setDownstreamResource(resource: string): void {
    this._downstreamResource = resource;
  }
}

// ── Main class ────────────────────────────────────────────────────────────────

export class PrismMCP {
  private readonly key:        string;
  private readonly tracker:    McpEventTracker;
  private readonly budget:     SessionBudgetChecker;
  private readonly redactKeys: string[];
  private readonly opts: Required<Pick<PrismMcpOptions,
    "project" | "team" | "environment" | "sessionId" | "serverName" |
    "captureInputs" | "captureOutputs" | "autoOutcome">> &
    Pick<PrismMcpOptions, "sessionBudgetUsd" | "maxToolCallsPerSession" | "customerId">;

  /**
   * AbortController scoped to this MCP session.
   *
   * When the session budget or tool-call limit is exceeded, this controller
   * is aborted with the originating error. Agent frameworks can wire this
   * signal into their own async operations to cancel inflight work:
   *
   * @example
   * const mcp = new PrismMCP({ sessionBudgetUsd: 5.00 });
   * const result = await openai.chat.completions.create(
   *   { model: "gpt-4o", messages },
   *   { signal: mcp.signal },   // ← cancels OpenAI call if budget exceeded
   * );
   */
  readonly abortController = new AbortController();

  /** AbortSignal that fires when this session's budget or tool-call limit is exceeded. */
  get signal(): AbortSignal { return this.abortController.signal; }

  constructor(options: PrismMcpOptions = {}) {
    const key = options.prismKey ?? process.env["PRISM_API_KEY"] ?? "";
    if (!key) {
      console.warn("[prism-mcp] PRISM_API_KEY not set — MCP observability disabled.");
    }

    this.opts = {
      project:                options.project        ?? process.env["PRISM_PROJECT"]     ?? "",
      team:                   options.team           ?? process.env["PRISM_TEAM"]        ?? "",
      environment:            options.environment    ?? process.env["PRISM_ENVIRONMENT"] ?? "production",
      sessionId:              options.sessionId      ?? crypto.randomUUID(),
      serverName:             options.serverName     ?? "mcp-server",
      sessionBudgetUsd:       options.sessionBudgetUsd,
      maxToolCallsPerSession: options.maxToolCallsPerSession,
      captureInputs:          options.captureInputs  ?? false,
      captureOutputs:         options.captureOutputs ?? false,
      autoOutcome:            options.autoOutcome    ?? false,
      customerId:             options.customerId,
    };
    this.key        = key;
    this.redactKeys = options.redactKeys ?? DEFAULT_REDACT_KEYS;
    this.tracker    = new McpEventTracker(key, this.opts.serverName, options.ingestUrl);
    this.budget     = new SessionBudgetChecker(orgFromKey(key));
  }

  /**
   * Signal that the current session completed successfully.
   * When `autoOutcome` is true this is called automatically; you can also
   * call it explicitly when your agent flow finishes.
   *
   * Emits an outcome_event to the Prism ingest endpoint so the session
   * shows up as a success in the Unit Economics dashboard.
   */
  async endSession(opts: { success?: boolean; valueUsd?: number } = {}): Promise<void> {
    const { success = true, valueUsd } = opts;
    const ingestBase = (
      process.env["PRISM_APP_URL"] ??
      process.env["NEXT_PUBLIC_APP_URL"] ??
      "https://useprism.dev"
    ).replace(/\/$/, "");

    if (!this.key) return;

    try {
      await fetch(`${ingestBase}/api/outcomes`, {
        method:  "POST",
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body:    JSON.stringify({
          feature_tag: this.opts.project || "mcp_session",
          action_tag:  "session_completed",
          session_id:  this.opts.sessionId,
          success,
          value_usd:   valueUsd,
        }),
      });
    } catch { /* Never propagate */ }
  }

  // ── Core primitive wrapper ─────────────────────────────────────────────────

  /**
   * Internal wrapper used by all four MCP primitives.
   * Handles: budget check, I/O capture, streaming proxy, fire-and-forget telemetry,
   * and actual cost self-reporting via ctx.reportActualCost().
   */
  private async _wrap<T>(
    primitiveType: McpPrimitiveType,
    name:          string,
    fn:            (ctx: WrapContext) => Promise<T>,
    extra: {
      llmRequestId?:       string;
      tags?:               Record<string, string>;
      downstreamResource?: string;
      inputs?:             Record<string, unknown>;
    } = {},
  ): Promise<T> {
    // 1. Pre-call budget/loop guard — abort signal fires so agent can cancel inflight work
    try {
      await this.budget.checkOrThrow(
        this.opts.sessionId,
        this.opts.sessionBudgetUsd,
        this.opts.maxToolCallsPerSession,
      );
    } catch (err) {
      // Abort any downstream operations wired to mcp.signal (e.g., OpenAI calls)
      if (!this.abortController.signal.aborted) {
        this.abortController.abort(err);
      }
      throw err;
    }

    const start    = Date.now();
    let   status:   "ok" | "error" | "timeout" = "ok";
    let   errorMsg = "";
    let   result:  T;
    const ctx      = new WrapContext();

    // Build tags — I/O capture applied here
    const eventTags: Record<string, string> = { ...extra.tags };
    if (this.opts.captureInputs && extra.inputs != null) {
      eventTags["tool_input"] = safeJson(extra.inputs, this.redactKeys, 1000);
    }

    // Cost lookup — overridden by ctx.reportActualCost() if called during fn()
    const estimatedCost = primitiveType === "tool" ? lookupToolCost(name) : 0;

    const fireEvent = (latencyMs: number, finalStatus: "ok" | "error" | "timeout") => {
      const actualCostUsd = ctx._actualCostUsd;
      this.tracker.capture({
        timestamp:            new Date().toISOString().replace("T", " ").slice(0, 23),
        session_id:           this.opts.sessionId,
        project_id:           this.opts.project,
        team_id:              this.opts.team,
        user_id:              "",
        environment:          this.opts.environment,
        tool_name:            name,
        downstream_resource:  ctx._downstreamResource ?? extra.downstreamResource ?? "",
        execution_latency_ms: latencyMs,
        tool_cost_usd:        actualCostUsd ?? estimatedCost,
        cost_status:          actualCostUsd != null ? "actual" : "estimated",
        status:               finalStatus,
        error_message:        errorMsg,
        llm_request_id:       extra.llmRequestId ?? "",
        primitive_type:       primitiveType,
        tags:                 eventTags,
        customer_id:          this.opts.customerId ?? "",
      }).catch(() => {});
    };

    try {
      result = await fn(ctx);
    } catch (err) {
      status   = "error";
      errorMsg = err instanceof Error ? err.message : String(err);
      fireEvent(Date.now() - start, status);
      throw err;
    }

    // Capture output if requested (non-streaming path)
    if (this.opts.captureOutputs && result != null && !isAsyncIterable(result)) {
      eventTags["tool_output"] = safeJson(result, this.redactKeys, 1000);
    }

    // Streaming path — defer telemetry until stream is exhausted
    if (isAsyncIterable(result)) {
      return proxyAsyncIterable(
        result as AsyncIterable<unknown>,
        start,
        (latencyMs, threw) => {
          fireEvent(latencyMs, threw ? "error" : "ok");
        },
      ) as unknown as T;
    }

    // Non-streaming path — fire immediately
    fireEvent(Date.now() - start, status);
    return result;
  }

  // ── Public API: tools ──────────────────────────────────────────────────────

  /**
   * Wrap a tools/call execution with Prism instrumentation.
   */
  async wrapToolCall<T>(
    toolName: string,
    fn: (ctx: WrapContext) => Promise<T>,
    extra: {
      llmRequestId?:       string;
      tags?:               Record<string, string>;
      downstreamResource?: string;
      /** Raw tool arguments — captured if captureInputs: true */
      inputs?:             Record<string, unknown>;
    } = {},
  ): Promise<T> {
    return this._wrap("tool", toolName, fn, extra);
  }

  /**
   * Drop-in patch for MCP SDK's CallToolRequestSchema handler.
   * Automatically passes req.params.arguments as inputs when captureInputs: true.
   * ctx is available for reportActualCost() inside the handler.
   */
  patchHandler<TReq extends { params: { name: string; arguments?: Record<string, unknown> } }, TRes>(
    handler: (req: TReq, ctx: WrapContext) => Promise<TRes>,
  ): (req: TReq) => Promise<TRes> {
    const self = this;
    return async function patchedHandler(req: TReq): Promise<TRes> {
      return self.wrapToolCall(
        req.params.name,
        (ctx) => handler(req, ctx),
        { inputs: req.params.arguments },
      );
    };
  }

  // ── Public API: resources ──────────────────────────────────────────────────

  /**
   * Wrap a resources/read execution with Prism instrumentation.
   *
   * @param resourceUri - The resource URI being read (e.g. "file:///path/to/file")
   */
  async wrapResourceRead<T>(
    resourceUri: string,
    fn: (ctx: WrapContext) => Promise<T>,
    extra: {
      llmRequestId?: string;
      tags?:         Record<string, string>;
    } = {},
  ): Promise<T> {
    return this._wrap("resource", resourceUri, fn, extra);
  }

  patchResourceHandler<TReq extends { params: { uri: string } }, TRes>(
    handler: (req: TReq, ctx: WrapContext) => Promise<TRes>,
  ): (req: TReq) => Promise<TRes> {
    const self = this;
    return async function patchedResourceHandler(req: TReq): Promise<TRes> {
      return self.wrapResourceRead(req.params.uri, (ctx) => handler(req, ctx));
    };
  }

  // ── Public API: prompts ────────────────────────────────────────────────────

  async wrapPromptGet<T>(
    promptName: string,
    fn: (ctx: WrapContext) => Promise<T>,
    extra: {
      llmRequestId?: string;
      tags?:         Record<string, string>;
    } = {},
  ): Promise<T> {
    return this._wrap("prompt", promptName, fn, extra);
  }

  patchPromptHandler<TReq extends { params: { name: string } }, TRes>(
    handler: (req: TReq, ctx: WrapContext) => Promise<TRes>,
  ): (req: TReq) => Promise<TRes> {
    const self = this;
    return async function patchedPromptHandler(req: TReq): Promise<TRes> {
      return self.wrapPromptGet(req.params.name, (ctx) => handler(req, ctx));
    };
  }

  // ── Public API: sampling ───────────────────────────────────────────────────

  /**
   * Wrap the MCP client's sampling/createMessage callback so LLM calls
   * requested by the MCP server appear in the session timeline.
   *
   * Usage with @modelcontextprotocol/sdk:
   *   client.setRequestHandler(
   *     CreateMessageRequestSchema,
   *     prismMcp.wrapSamplingHandler(async (req) => {
   *       const res = await openai.chat.completions.create({ ... });
   *       return { role: "assistant", content: [{ type: "text", text: res.choices[0].message.content }] };
   *     })
   *   );
   */
  wrapSamplingHandler<
    TReq extends { params?: { modelPreferences?: { hints?: Array<{ name?: string }> } } },
    TRes,
  >(
    handler: (req: TReq) => Promise<TRes>,
  ): (req: TReq) => Promise<TRes> {
    const self = this;
    return async function patchedSamplingHandler(req: TReq): Promise<TRes> {
      // Use model hint as the "tool_name" for display in the session timeline
      const modelHint =
        req.params?.modelPreferences?.hints?.[0]?.name ?? "sampling";
      return self._wrap("sampling", modelHint, (_ctx) => handler(req));
    };
  }

  /** The session_id assigned to this instance (useful for logging). */
  get sessionId(): string { return this.opts.sessionId; }
}
