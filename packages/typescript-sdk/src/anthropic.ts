import Anthropic from "@anthropic-ai/sdk";
import type { ClientOptions } from "@anthropic-ai/sdk";
import { EventTracker } from "./tracker";
import { BudgetChecker } from "./budget";
import { detectGitContext } from "./git";
import type { PrismOptions } from "./types";

/**
 * Wraps an Anthropic Stream. Anthropic streaming uses typed events (message_start,
 * content_block_delta, message_delta) rather than a single final usage chunk.
 * Accumulates input tokens from message_start and output tokens from message_delta.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapAnthropicStreamWithCapture(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stream: any,
  onUsage: (inputTokens: number, outputTokens: number, cachedTokens: number, model: string) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return new Proxy(stream, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(target: any, prop: string | symbol) {
      if (prop !== Symbol.asyncIterator) return Reflect.get(target, prop);
      return function () {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const iter = target[Symbol.asyncIterator]() as AsyncIterator<any>;
        let inputTokens = 0, outputTokens = 0, cachedTokens = 0, model = "";
        return {
          async next() {
            const result = await iter.next();
            if (!result.done) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const ev = result.value as any;
              if (ev?.type === "message_start") {
                inputTokens  = ev.message?.usage?.input_tokens ?? 0;
                cachedTokens = (ev.message?.usage?.cache_read_input_tokens ?? 0)
                             + (ev.message?.usage?.cache_creation_input_tokens ?? 0);
                model = ev.message?.model ?? "";
              }
              if (ev?.type === "message_delta") {
                outputTokens = ev.usage?.output_tokens ?? outputTokens;
              }
            }
            if (result.done) {
              onUsage(inputTokens, outputTokens, cachedTokens, model);
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

// Shared x-prism-* header extractor (mirrors openai.ts)
function extractPrismHeaders(
  headers: Record<string, string> | undefined,
): { callTags: Record<string, string>; strippedHeaders: Record<string, string> | undefined } {
  if (!headers) return { callTags: {}, strippedHeaders: undefined };
  const callTags: Record<string, string>        = {};
  const strippedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === "x-prism-tags") {
      try { Object.assign(callTags, JSON.parse(v)); } catch { /* ignore */ }
    } else if (lower.startsWith("x-prism-") &&
               lower !== "x-prism-key" &&
               lower !== "x-prism-branch" &&
               lower !== "x-prism-commit") {
      callTags[lower.slice(8)] = v;
    } else {
      strippedHeaders[k] = v;
    }
  }
  return { callTags, strippedHeaders: Object.keys(strippedHeaders).length ? strippedHeaders : undefined };
}

export class PrismAnthropic extends Anthropic {
  private _tracker: EventTracker | null = null;
  private _budget:  BudgetChecker | null = null;
  private _project: string;
  private _team:    string;
  private _env:     string;

  constructor(options: ClientOptions & PrismOptions = {}) {
    const { prismKey, project, team, environment, ingestUrl, mode, sessionId, traceId, softCapModel, softCapPct, capturePayloads, redact, ...base } = options;

    const key = prismKey ?? process.env["PRISM_API_KEY"];

    if (mode === "gateway" && key) {
      const appUrl = (
        process.env["PRISM_APP_URL"] ??
        process.env["NEXT_PUBLIC_APP_URL"] ??
        "https://useprism.dev"
      ).replace(/\/$/, "");
      (base as ClientOptions).baseURL  = `${appUrl}/api/gateway/anthropic`;
      (base as ClientOptions).apiKey   = key;  // satisfies Anthropic client validation
      (base as ClientOptions).defaultHeaders = {
        ...(base as ClientOptions).defaultHeaders,
        "x-prism-key": key,
        ...(traceId ? { "x-prism-trace-id": traceId } : {}),
      };
    }

    super(base);

    this._project = project     ?? process.env["PRISM_PROJECT"]     ?? "";
    this._team    = team        ?? process.env["PRISM_TEAM"]        ?? "";
    this._env     = environment ?? process.env["PRISM_ENVIRONMENT"] ?? "production";

    if (key && mode !== "gateway") {
      const gitCtx  = detectGitContext();
      const sid = sessionId ?? crypto.randomUUID();
      const defaultTags = { ...gitCtx, session_id: sid };
      this._tracker     = new EventTracker(key, ingestUrl, defaultTags);
      this._tracker.capturePayloads = capturePayloads ?? "off";
      this._tracker.redact          = redact;
      this._budget      = new BudgetChecker(key);
      this._softCapModel = softCapModel;
      this._softCapPct   = softCapPct ?? 80;
      this._patch();
    } else if (!key) {
      console.warn("[prism] PRISM_API_KEY not set — observability disabled.");
    }
  }

  /** Flush all queued telemetry events immediately. Call before a serverless function returns. */
  async flush(): Promise<void> {
    await this._tracker?.flush();
  }

  private _softCapModel: string | undefined;
  private _softCapPct: number = 80;

  private _patch(): void {
    const tracker = this._tracker;
    const budget  = this._budget;
    const project = this._project;
    const team    = this._team;
    const env     = this._env;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const self    = this as any;

    this.messages = new Proxy(this.messages, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get(target: any, prop: string | symbol) {
        if (prop !== "create") return Reflect.get(target, prop);

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return async function (body: any, options?: any) {
          // P1-A: extract x-prism-* call-level tags
          const { callTags, strippedHeaders } = extractPrismHeaders(
            options?.headers as Record<string, string> | undefined,
          );
          if (strippedHeaders !== undefined && options) {
            options = { ...options, headers: strippedHeaders };
          }

          // P1-B: soft-cap model downgrade
          const softCapModel = self._softCapModel as string | undefined;
          const softCapPct   = self._softCapPct   as number;
          if (budget && softCapModel) {
            const status = await budget.checkStatus(softCapPct);
            if (status === "hard_cap_exceeded") await budget.checkOrThrow();
            if (status === "soft_cap_hit") {
              callTags["model_downgraded_from"] = body?.model ?? "";
              body = { ...body, model: softCapModel };
            }
          } else if (budget) {
            await budget.checkOrThrow();
          }

          const start     = Date.now();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const res: any  = await Reflect.apply(target.create, target, [body, options]);
          const latencyMs = Date.now() - start;

          if (tracker && body?.stream) {
            // Wrap stream: capture fires once message_delta (final usage) is seen
            return wrapAnthropicStreamWithCapture(
              res,
              (inputTokens, outputTokens, cachedTokens, model) => {
                if (!inputTokens && !outputTokens) return;
                tracker.captureRaw(
                  { model, id: "" },
                  latencyMs, project, team, env, "anthropic",
                  inputTokens, outputTokens, cachedTokens,
                  0, 0, 0, "text", {}, callTags,
                ).catch(() => {});
              },
            );
          }

          if (tracker) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const toolUse: any[] = Array.isArray(res.content)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ? res.content.filter((b: any) => b?.type === "tool_use")
              : [];
            const extraTags: Record<string, string> = {};
            if (toolUse.length > 0) {
              extraTags["tool_calls_count"] = String(toolUse.length);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              extraTags["tool_names"] = toolUse.map((b: any) => b.name ?? "unknown").join(",");
            }
            tracker.captureRaw(
              res, latencyMs, project, team, env, "anthropic",
              res.usage?.input_tokens  ?? 0,
              res.usage?.output_tokens ?? 0,
              0, 0, 0, 0, "text", extraTags, callTags,
            ).catch(() => {});
          }

          return res;
        };
      },
    });
  }
}
