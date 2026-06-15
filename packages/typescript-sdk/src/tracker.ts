import { calculateCost, normalizeModelName } from "./pricing";
import { getCurrentTrace } from "./trace";
import type { LLMEvent } from "./types";

/** Extract and SHA-256 hash the system prompt from a messages array.
 *  Returns the first 12 hex chars, or empty string if no system message found. */
async function hashSystemPrompt(messages: unknown[]): Promise<string> {
  if (!Array.isArray(messages)) return "";
  const systemContent = messages
    .filter(m => (m as Record<string, unknown>)?.role === "system")
    .map(m => {
      const c = (m as Record<string, unknown>)?.content;
      return typeof c === "string" ? c : JSON.stringify(c ?? "");
    })
    .join("\n");
  if (!systemContent) return "";
  try {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest("SHA-256", enc.encode(systemContent));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
  } catch {
    return "";
  }
}

function detectModalities(messages: unknown[]): string {
  const mods = new Set(["text"]);
  for (const msg of messages) {
    const content = (msg as Record<string, unknown>)?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        const t = (block as Record<string, unknown>)?.type;
        if (t === "image_url")   mods.add("image");
        if (t === "input_audio") mods.add("audio");
        if (t === "file")        mods.add("document");
      }
    }
  }
  return [...mods].sort().join(",");
}

function defaultIngestUrl(): string {
  const appUrl = (
    process.env["PRISM_APP_URL"] ??
    process.env["NEXT_PUBLIC_APP_URL"] ??
    "https://useprism.dev"
  ).replace(/\/$/, "");
  return `${appUrl}/api/ingest`;
}

// Module-level registry so all EventTracker instances share one beforeExit listener.
// This avoids MaxListenersExceededWarning when many instances are created (e.g. in tests).
const _trackerRegistry = new Set<EventTracker>();
let _exitListenerRegistered = false;

export class EventTracker {
  private readonly key:            string;
  private readonly ingestUrl:      string;
  private readonly defaultTags:    Record<string, string>;
  private readonly batchSize:      number;
  private readonly flushIntervalMs: number;

  private queue:      LLMEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  // PRD-0 content capture — set by the provider wrapper from PrismOptions.
  capturePayloads: "off" | "redacted" | "full" = "off";
  redact?: (text: string) => string;

  constructor(
    key:            string,
    ingestUrl?:     string,
    defaultTags?:   Record<string, string>,
    /** Max events to accumulate before flushing immediately. Default: 10. */
    batchSize       = 10,
    /** Max ms to hold events before flushing. Default: 5000. */
    flushIntervalMs = 5000,
  ) {
    this.key             = key;
    this.ingestUrl       = ingestUrl ?? defaultIngestUrl();
    this.defaultTags     = defaultTags ?? {};
    this.batchSize       = batchSize;
    this.flushIntervalMs = flushIntervalMs;

    // Register with the shared exit hook. A single process.on("beforeExit")
    // drains all trackers, regardless of how many instances are created.
    if (typeof process !== "undefined" && typeof process.on === "function") {
      _trackerRegistry.add(this);
      if (!_exitListenerRegistered) {
        _exitListenerRegistered = true;
        process.on("beforeExit", () => {
          _trackerRegistry.forEach(t => { t.flush().catch(() => {}); });
        });
      }
    }
  }

  /** Unregister this tracker from the shared exit hook and clear its timer. */
  destroy(): void {
    _trackerRegistry.delete(this);
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Flush all queued events immediately.
   *
   * Call this before a serverless function returns to ensure no events are lost:
   *   await tracker.flush();
   */
  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this._sendBatch(this.queue.splice(0));
  }

  private _scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this._sendBatch(this.queue.splice(0)).catch(() => {});
    }, this.flushIntervalMs);
  }

  private _enqueue(event: LLMEvent): void {
    this.queue.push(event);
    if (this.queue.length >= this.batchSize) {
      // Batch full — flush immediately, cancel any pending timer
      if (this.flushTimer !== null) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this._sendBatch(this.queue.splice(0)).catch(() => {});
    } else {
      this._scheduleFlush();
    }
  }

  private async _sendBatch(batch: LLMEvent[]): Promise<void> {
    if (batch.length === 0) return;
    try {
      const res = await fetch(this.ingestUrl, {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${this.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ events: batch }),
      });
      if (res.status === 402) {
        const data = await res.json().catch(() => ({})) as { error?: string; cap_id?: string };
        console.warn(
          `[prism] Spend cap exceeded — events not recorded. ` +
          `${data.cap_id ? `Cap ID: ${data.cap_id}. ` : ""}` +
          `Increase the cap or switch to gateway mode (set PRISM_GATEWAY_URL).`,
        );
      } else if (res.status === 403) {
        const data = await res.json().catch(() => ({})) as { error?: string; message?: string };
        console.warn(
          `[prism] Model blocked by org policy — events not recorded. ` +
          `${data.message ?? data.error ?? "Contact your admin to update model governance settings."}`,
        );
      } else if (res.status === 422) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        console.warn(`[prism] ${data.message ?? "Events rejected — project requires git branch tracking. Set GITHUB_REF_NAME env var."}`);
      }
    } catch {
      // Never propagate — observability must never break the caller
    }
  }

  async capture(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response:    any,
    latencyMs:   number,
    projectId:   string = "",
    teamId:      string = "",
    environment: string = "production",
    provider:    string = "openai",
    messages:    unknown[] = [],
    /** Per-call tags merged on top of defaultTags — used for runtime feature attribution */
    callTags:    Record<string, string> = {},
    /** Time-to-first-token in ms (0 for non-streaming calls) */
    ttftMs:      number = 0,
  ): Promise<void> {
    try {
      // Streaming responses return an async-iterable Stream object — usage is not
      // available until the stream is fully consumed. Skip to avoid zero-token noise.
      if (!response?.usage) return;
      const usage  = response.usage;
      const model: string  = normalizeModelName(response.model ?? "");
      const details     = usage?.prompt_tokens_details;
      const compDetails = usage?.completion_tokens_details;
      const cached:      number = details?.cached_tokens ?? 0;
      const imageTokens: number = details?.image_tokens  ?? 0;
      const audioTokens: number = compDetails?.audio_tokens ?? 0;
      const textTokens:  number = details?.text_tokens   ?? 0;

      // Detect tool calls — OpenAI: choices[0].message.tool_calls
      //                      Anthropic: content[type=tool_use]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const openaiToolCalls: any[] = response.choices?.[0]?.message?.tool_calls ?? [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anthropicContent: any[] = Array.isArray(response.content) ? response.content : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anthropicToolUse = anthropicContent.filter((b: any) => b?.type === "tool_use");
      const allToolCalls = openaiToolCalls.length ? openaiToolCalls : anthropicToolUse;

      const eventTags: Record<string, string> = { ...this.defaultTags, ...callTags };

      // Auto-hash the system prompt for lightweight prompt versioning.
      // Only added if the caller hasn't already set system_prompt_hash.
      if (!eventTags["system_prompt_hash"] && messages.length > 0) {
        const promptHash = await hashSystemPrompt(messages);
        if (promptHash) eventTags["system_prompt_hash"] = promptHash;
      }

      if (allToolCalls.length > 0) {
        eventTags["tool_calls_count"] = String(allToolCalls.length);
        eventTags["tool_names"] = allToolCalls
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((t: any) => t.name ?? t.function?.name ?? "unknown")
          .join(",");
      }

      const traceCtx = getCurrentTrace();
      const event: LLMEvent = {
        event_id:     crypto.randomUUID(),
        timestamp:    new Date().toISOString().replace("T", " ").slice(0, 23),
        org_id:       this._orgFromKey(),
        project_id:   projectId,
        project_name: projectId,
        team_id:      teamId,
        user_id:      "",
        environment,
        provider,
        model,
        input_tokens:  usage?.prompt_tokens    ?? 0,
        output_tokens: usage?.completion_tokens ?? 0,
        cached_tokens: cached,
        image_tokens:  imageTokens,
        audio_tokens:  audioTokens,
        text_tokens:   textTokens,
        modalities:    detectModalities(messages),
        cost_usd:     calculateCost(model, usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0, cached),
        latency_ms:   latencyMs,
        ttft_ms:      ttftMs,
        status_code:  200,
        request_id:   response.id ?? "",
        tags:         eventTags,
        trace_id:      traceCtx?.traceId      ?? "",
        span_id:       traceCtx?.spanId       ?? "",
        parent_span_id: traceCtx?.parentSpanId ?? "",
        attributes:    traceCtx?.attributes && Object.keys(traceCtx.attributes).length > 0
                         ? JSON.stringify(traceCtx.attributes)
                         : "",
      };

      if (this.capturePayloads !== "off") event.payload = this._buildPayload(messages, response);

      this._enqueue(event);
    } catch {
      // Never propagate — observability must never break the caller
    }
  }

  /** Capture with explicit token counts — used by non-OpenAI provider wrappers. */
  async captureRaw(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response:     any,
    latencyMs:    number,
    projectId:    string,
    teamId:       string,
    environment:  string,
    provider:     string,
    inputTokens:  number,
    outputTokens: number,
    cachedTokens: number,
    imageTokens:  number = 0,
    audioTokens:  number = 0,
    textTokens:   number = 0,
    modalities:   string = "text",
    extraTags:    Record<string, string> = {},
    /** Per-call tags merged on top of defaultTags — runtime feature attribution */
    callTags:     Record<string, string> = {},
  ): Promise<void> {
    try {
      const model   = normalizeModelName((response.model ?? "") as string);
      const traceCtxRaw = getCurrentTrace();
      const event: LLMEvent = {
        event_id:     crypto.randomUUID(),
        timestamp:    new Date().toISOString().replace("T", " ").slice(0, 23),
        org_id:       this._orgFromKey(),
        project_id:   projectId,
        project_name: projectId,
        team_id:      teamId,
        user_id:      "",
        environment,
        provider,
        model,
        input_tokens:  inputTokens,
        output_tokens: outputTokens,
        cached_tokens: cachedTokens,
        image_tokens:  imageTokens,
        audio_tokens:  audioTokens,
        text_tokens:   textTokens,
        modalities,
        cost_usd:     calculateCost(model, inputTokens, outputTokens, cachedTokens),
        latency_ms:   latencyMs,
        ttft_ms:      0,
        status_code:  200,
        request_id:   response.id ?? "",
        tags:         { ...this.defaultTags, ...extraTags, ...callTags },
        trace_id:      traceCtxRaw?.traceId      ?? "",
        span_id:       traceCtxRaw?.spanId       ?? "",
        parent_span_id: traceCtxRaw?.parentSpanId ?? "",
      };

      if (this.capturePayloads !== "off") event.payload = this._buildPayload([], response);

      this._enqueue(event);
    } catch {
      // Never propagate
    }
  }

  /**
   * Record that a feature or action produced a business outcome.
   *
   * Use this after a successful (or failed) business event to enable
   * actual cost-per-successful-action tracking in the Unit Economics dashboard.
   *
   * @example
   * await tracker.recordOutcome({ featureTag: "customer-support", success: true, valueUsd: 3.00 });
   */
  async recordOutcome(opts: {
    featureTag:  string;
    actionTag?:  string;
    sessionId?:  string;
    success?:    boolean;
    valueUsd?:   number;
    metadata?:   Record<string, unknown>;
    occurredAt?: string;
  }): Promise<void> {
    try {
      const outcomesUrl = this.ingestUrl.replace(/\/api\/ingest$/, "/api/outcomes");
      await fetch(outcomesUrl, {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${this.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          feature_tag:  opts.featureTag,
          action_tag:   opts.actionTag,
          session_id:   opts.sessionId,
          success:      opts.success ?? true,
          value_usd:    opts.valueUsd,
          metadata:     opts.metadata,
          occurred_at:  opts.occurredAt,
        }),
      });
    } catch { /* Never propagate */ }
  }

  /**
   * Record a GPU inference cost event (SageMaker, RunPod, Modal, Lambda GPU, etc.).
   * Appears in the FinOps Infrastructure breakdown alongside LLM and MCP costs.
   */
  async recordGpuInference(opts: {
    provider:         "aws_sagemaker" | "lambda_labs" | "runpod" | "modal" | "vertex_ai" | "azure_ml" | "other";
    endpointName:     string;
    costUsd:          number;
    instanceType?:    string;
    durationSeconds?: number;
    requests?:        number;
    sessionId?:       string;
    startTime?:       string;
    endTime?:         string;
    tags?:            Record<string, unknown>;
  }): Promise<void> {
    try {
      const gpuUrl = this.ingestUrl.replace(/\/api\/ingest$/, "/api/gpu-inference");
      await fetch(gpuUrl, {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${this.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          runs: [{
            provider:         opts.provider,
            endpoint_name:    opts.endpointName,
            cost_usd:         opts.costUsd,
            instance_type:    opts.instanceType,
            duration_seconds: opts.durationSeconds,
            requests:         opts.requests,
            session_id:       opts.sessionId,
            start_time:       opts.startTime,
            end_time:         opts.endTime,
            tags:             opts.tags,
          }],
        }),
      });
    } catch { /* Never propagate */ }
  }

  /** Build the optional content payload from prompt messages + provider response (PRD-0). */
  private _buildPayload(messages: unknown[], response: unknown): LLMEvent["payload"] {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = response as any;
      const doRedact  = this.capturePayloads === "redacted" && typeof this.redact === "function";
      const redactStr = (s: string): string => (doRedact ? this.redact!(s) : s);
      const redactDeep = (v: unknown): unknown => {
        if (typeof v === "string") return redactStr(v);
        if (Array.isArray(v))      return v.map(redactDeep);
        if (v && typeof v === "object") {
          return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, redactDeep(val)]));
        }
        return v;
      };

      const prompt = Array.isArray(messages) && messages.length > 0
        ? (redactDeep(messages) as unknown[])
        : undefined;

      let completion: string | undefined;
      const oa = r?.choices?.[0]?.message?.content;
      if (typeof oa === "string") {
        completion = oa;
      } else if (Array.isArray(r?.content)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text = r.content.filter((b: any) => b?.type === "text").map((b: any) => b.text ?? "").join("\n");
        completion = text || undefined;
      }
      if (completion) completion = redactStr(completion);

      return { prompt, completion, pre_redacted: doRedact ? true : undefined };
    } catch {
      return undefined;
    }
  }

  private _orgFromKey(): string {
    const parts = this.key.split("_");
    return parts.length >= 4 ? parts[2]! : "";
  }
}
