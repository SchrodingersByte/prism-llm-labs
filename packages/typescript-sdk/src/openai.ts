import OriginalOpenAI, { type ClientOptions } from "openai";
import { BudgetChecker, BudgetExceededError } from "./budget";
import { EventTracker } from "./tracker";
import { detectGitContext } from "./git";
import type { PrismOptions } from "./types";

/**
 * Extract x-prism-* headers from a request options object.
 * Returns { callTags, strippedHeaders } where strippedHeaders has the
 * prism-specific headers removed so they are never forwarded upstream.
 *
 * Supports:
 *   "x-prism-feature": "contextual-search"  → tags.feature = "contextual-search"
 *   "x-prism-user-tier": "enterprise"        → tags.user-tier = "enterprise"
 *   "x-prism-tags": '{"feature":"x"}'        → merged into tags
 */
function extractPrismHeaders(
  headers: Record<string, string> | undefined,
): { callTags: Record<string, string>; strippedHeaders: Record<string, string> | undefined } {
  if (!headers) return { callTags: {}, strippedHeaders: undefined };

  const callTags: Record<string, string>     = {};
  const strippedHeaders: Record<string, string> = {};

  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === "x-prism-tags") {
      try { Object.assign(callTags, JSON.parse(v)); } catch { /* ignore malformed JSON */ }
    } else if (lower.startsWith("x-prism-") &&
               // Keep x-prism-key (auth) — don't strip it
               lower !== "x-prism-key" &&
               lower !== "x-prism-branch" &&
               lower !== "x-prism-commit") {
      // Strip "x-prism-" prefix, use remainder as tag key
      callTags[lower.slice(8)] = v;
    } else {
      strippedHeaders[k] = v;
    }
  }

  return { callTags, strippedHeaders: Object.keys(strippedHeaders).length ? strippedHeaders : undefined };
}

/**
 * Wraps an OpenAI Stream so that when the final chunk (which carries usage when
 * stream_options.include_usage=true is set) is consumed, telemetry fires.
 * All other stream properties and methods pass through transparently.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapStreamWithCapture(stream: any, streamStart: number, onUsage: (usage: any, model: string, ttftMs: number) => void): any {
  return new Proxy(stream, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(target: any, prop: string | symbol) {
      if (prop !== Symbol.asyncIterator) return Reflect.get(target, prop);
      return function () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const iter = target[Symbol.asyncIterator]() as AsyncIterator<any>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let lastUsage: any = null;
        let lastModel = "";
        let ttftMs    = 0;  // time-to-first-token in ms
        return {
          async next() {
            const result = await iter.next();
            if (!result.done) {
              const chunk = result.value;
              if (chunk?.usage) { lastUsage = chunk.usage; }
              if (chunk?.model) { lastModel = chunk.model; }
              // Capture TTFT on first non-empty content delta
              if (ttftMs === 0) {
                const delta = chunk?.choices?.[0]?.delta?.content;
                if (delta) ttftMs = Date.now() - streamStart;
              }
            }
            if (result.done) {
              onUsage(lastUsage, lastModel, ttftMs);
            }
            return result;
          },
          [Symbol.asyncIterator]() { return this; },
          return: iter.return?.bind(iter),
          throw:  iter.throw?.bind(iter),
        };
      };
    },
  });
}

export class OpenAI extends OriginalOpenAI {
  private _tracker: EventTracker | null = null;
  private _budget:  BudgetChecker | null = null;
  private _project: string;
  private _team:    string;
  private _env:     string;

  /**
   * Flush all queued telemetry events immediately.
   * Call this before a serverless function returns to ensure no events are lost:
   *   const openai = new OpenAI({ prismKey: "..." });
   *   // ... make LLM calls ...
   *   await openai.flush();
   */
  async flush(): Promise<void> {
    await this._tracker?.flush();
  }

  constructor(options: ClientOptions & PrismOptions = {}) {
    const { prismKey, project, team, environment, ingestUrl, mode, sessionId, traceId, softCapModel, softCapPct, ...base } = options;

    const key = prismKey ?? process.env["PRISM_API_KEY"];

    // Detect git context and session_id regardless of mode so gateway mode
    // can forward them as headers for server-side tag capture.
    const gitCtx = detectGitContext();
    const sid    = sessionId ?? crypto.randomUUID();

    // PRISM_GATEWAY_URL auto-enables gateway mode — no need to set mode="gateway" explicitly.
    const gatewayUrl = process.env["PRISM_GATEWAY_URL"];
    if (gatewayUrl && mode !== "gateway") {
      // Mutate options in-place so the gateway block below runs.
      (options as { mode?: string }).mode = "gateway";
    }
    const effectiveMode = gatewayUrl ? "gateway" : mode;

    // Gateway mode: re-base the client to the Prism proxy — no patching needed.
    if (effectiveMode === "gateway" && key) {
      const appUrl = (
        gatewayUrl ??
        process.env["PRISM_APP_URL"] ??
        process.env["NEXT_PUBLIC_APP_URL"] ??
        "https://useprism.dev"
      ).replace(/\/$/, "");

      const extraTags: Record<string, string> = { session_id: sid };
      if (gitCtx["git_author_email"]) extraTags["git_author_email"] = gitCtx["git_author_email"]!;
      if (gitCtx["git_author_name"])  extraTags["git_author_name"]  = gitCtx["git_author_name"]!;
      const costCenter = process.env["PRISM_COST_CENTER"];
      if (costCenter) extraTags["cost_center"] = costCenter;

      // Include /v1 so the OpenAI SDK appends /chat/completions correctly:
      // base/v1 + /chat/completions → /api/gateway/openai/v1/chat/completions
      // gateway strips prefix → upstream: https://api.openai.com/v1/chat/completions ✓
      (base as ClientOptions).baseURL  = `${appUrl}/api/gateway/openai/v1`;
      // Pass the Prism key as apiKey so the OpenAI SDK validation passes.
      // The gateway authenticates via Authorization: Bearer <prism_key>.
      (base as ClientOptions).apiKey   = key;
      (base as ClientOptions).defaultHeaders = {
        ...(base as ClientOptions).defaultHeaders,
        "x-prism-key":     key,
        "x-prism-gateway": "true",  // signals gateway-required mode check
        // Forward git context so the gateway records it in event tags
        ...(gitCtx["git_branch"] ? { "x-prism-branch": gitCtx["git_branch"]! } : {}),
        ...(gitCtx["git_commit"] ? { "x-prism-commit": gitCtx["git_commit"]! } : {}),
        "x-prism-tags":    JSON.stringify(extraTags),
        // Forward explicit trace_id so the gateway continues the same trace
        ...(traceId ? { "x-prism-trace-id": traceId } : {}),
      };
    }

    super(base);

    this._project = project     ?? process.env["PRISM_PROJECT"]     ?? "";
    this._team    = team        ?? process.env["PRISM_TEAM"]        ?? "";
    this._env     = environment ?? process.env["PRISM_ENVIRONMENT"] ?? "production";

    if (key && effectiveMode !== "gateway") {
      // gitCtx and sid already computed above (before the gateway mode block)
      const defaultTags: Record<string, string> = { ...gitCtx, session_id: sid };
      const costCenter = process.env["PRISM_COST_CENTER"];
      if (costCenter) defaultTags["cost_center"] = costCenter;
      this._tracker     = new EventTracker(key, ingestUrl, defaultTags);
      this._budget      = new BudgetChecker(key);
      this._softCapModel = softCapModel;
      this._softCapPct   = softCapPct ?? 80;
      this._patch();
    } else if (!key) {
      console.warn("[prism] PRISM_API_KEY not set — observability disabled.");
    }
  }

  private _softCapModel: string | undefined;
  private _softCapPct: number = 80;

  private _patch(): void {
    const tracker      = this._tracker;
    const budget       = this._budget;
    const project      = this._project;
    const team         = this._team;
    const env          = this._env;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self         = this as any;

    // Use Proxy instead of direct property assignment — survives OpenAI SDK
    // version changes that may alter the descriptor of `create`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.chat.completions = new Proxy(this.chat.completions, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get(target: any, prop: string | symbol) {
        if (prop !== "create") return Reflect.get(target, prop);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return async function (body: any, options?: any) {
          // ── P1-A: extract x-prism-* call-level tags from request headers ──
          const { callTags, strippedHeaders } = extractPrismHeaders(
            options?.headers as Record<string, string> | undefined,
          );
          if (strippedHeaders !== undefined && options) {
            options = { ...options, headers: strippedHeaders };
          }

          // ── P1-B: soft-cap model downgrade ────────────────────────────────
          const softCapModel = self._softCapModel as string | undefined;
          const softCapPct   = self._softCapPct   as number;
          if (budget && softCapModel) {
            const status = await budget.checkStatus(softCapPct);
            if (status === "hard_cap_exceeded") {
              // Re-use checkOrThrow to throw with real spend/limit values
              await budget.checkOrThrow();
            }
            if (status === "soft_cap_hit") {
              callTags["model_downgraded_from"] = body?.model ?? "";
              body = { ...body, model: softCapModel };
            }
          } else if (budget) {
            await budget.checkOrThrow();
          }
          void BudgetExceededError; // imported for side-effects / potential re-throw

          if (body?.stream) {
            body.stream_options = { ...body.stream_options, include_usage: true };
          }

          const start     = Date.now();
          const res       = await Reflect.apply(target.create, target, [body, options]);
          const latencyMs = Date.now() - start;

          if (tracker && body?.stream) {
            // Wrap stream: capture fires when the final usage chunk is consumed
            return wrapStreamWithCapture(res, start, (usage, model, ttftMs) => {
              if (!usage) return;
              tracker.capture(
                { usage, model, id: "", choices: [], content: [] },
                latencyMs, project, team, env, "openai", body?.messages ?? [], callTags, ttftMs,
              ).catch(() => {});
            });
          }

          if (tracker) {
            tracker.capture(res, latencyMs, project, team, env, "openai", body?.messages ?? [], callTags).catch(() => {});
          }

          return res;
        };
      },
    });
  }
}
