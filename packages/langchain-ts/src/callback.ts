/**
 * PrismCallbackHandler — LangChain callback that ships LLM call events
 * to Prism for cost tracking and observability.
 *
 * Attach to any LangChain chain, agent, or model:
 *
 *   const handler = new PrismCallbackHandler({ prismKey: process.env.PRISM_API_KEY });
 *   const result  = await chain.invoke(input, { callbacks: [handler] });
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { BaseCallbackHandlerInput } from "@langchain/core/callbacks/base";
import { BaseCallbackHandler }           from "@langchain/core/callbacks/base";
import type { Serialized }               from "@langchain/core/load/serializable";
import type { LLMResult }                from "@langchain/core/outputs";
import type { ChainValues }              from "@langchain/core/utils/types";

export interface PrismOptions {
  /** Prism API key (PRISM_API_KEY). */
  prismKey:     string;
  /** Project attribution tag. */
  project?:     string;
  /** Team attribution tag. */
  team?:        string;
  /** environment tag (default: "production"). */
  environment?: string;
  /** Override the Prism ingest URL. */
  ingestUrl?:   string;
}

// ── Minimal pricing (mirrors packages/typescript-sdk/src/pricing.ts) ─────────
// Keep in sync with the main SDK's pricing table.

const MODEL_PRICING: Record<string, { input: number; output: number; cached_input?: number }> = {
  "gpt-4o":          { input: 2.50,   output: 10.00,  cached_input: 1.25 },
  "gpt-4o-mini":     { input: 0.15,   output: 0.60,   cached_input: 0.075 },
  "gpt-4.1":         { input: 2.00,   output: 8.00,   cached_input: 0.50 },
  "gpt-4.1-mini":    { input: 0.40,   output: 1.60,   cached_input: 0.10 },
  "claude-opus-4":   { input: 15.00,  output: 75.00,  cached_input: 1.50 },
  "claude-sonnet-4": { input: 3.00,   output: 15.00,  cached_input: 0.30 },
  "claude-haiku-4":  { input: 0.80,   output: 4.00,   cached_input: 0.08 },
  "gemini-2.5-pro":  { input: 1.25,   output: 10.00 },
  "gemini-2.5-flash":{ input: 0.075,  output: 0.30 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number, cachedTokens = 0): number {
  const m = model.toLowerCase();
  const entry = Object.entries(MODEL_PRICING).find(([k]) => m.startsWith(k));
  if (!entry) return 0;
  const pricing = entry[1];
  const inputCost  = (inputTokens - cachedTokens) * pricing.input    / 1_000_000;
  const cachedCost =  cachedTokens               * (pricing.cached_input ?? pricing.input) / 1_000_000;
  const outputCost =  outputTokens               * pricing.output     / 1_000_000;
  return inputCost + cachedCost + outputCost;
}

function defaultIngestUrl(): string {
  return (
    process.env["PRISM_APP_URL"] ??
    process.env["NEXT_PUBLIC_APP_URL"] ??
    "https://useprism.dev"
  ).replace(/\/$/, "") + "/api/ingest";
}

// ── Handler ───────────────────────────────────────────────────────────────────

export class PrismCallbackHandler extends BaseCallbackHandler {
  override name = "PrismCallbackHandler";

  private readonly opts:     PrismOptions;
  private readonly startTimes = new Map<string, number>();
  private readonly chainNames = new Map<string, string>();

  constructor(opts: PrismOptions, input?: BaseCallbackHandlerInput) {
    super(input);
    this.opts = opts;
  }

  override async handleLLMStart(
    _llm: Serialized,
    _messages: any[],
    runId: string,
  ): Promise<void> {
    this.startTimes.set(runId, Date.now());
  }

  override async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    const latencyMs = Date.now() - (this.startTimes.get(runId) ?? Date.now());
    this.startTimes.delete(runId);

    const gen0    = output.generations?.[0]?.[0];
    const tokenUsage = output.llmOutput?.tokenUsage ?? output.llmOutput?.usage ?? {};

    const inputTokens  = tokenUsage.promptTokens     ?? tokenUsage.input_tokens     ?? 0;
    const outputTokens = tokenUsage.completionTokens  ?? tokenUsage.output_tokens    ?? 0;
    const cachedTokens = tokenUsage.cachedTokens      ?? tokenUsage.cached_tokens    ?? 0;
    const model        = (output.llmOutput?.model_name ?? output.llmOutput?.model ?? gen0?.generationInfo?.model ?? "unknown") as string;
    const requestId    = (output.llmOutput?.id ?? gen0?.generationInfo?.id ?? "") as string;

    const chainName = this.chainNames.get(runId) ?? "";
    const tags: Record<string, string> = {};
    if (chainName) tags["chain_name"] = chainName;
    if (this.opts.project) tags["project"] = this.opts.project;
    if (this.opts.team)    tags["team"]    = this.opts.team;

    const event = {
      event_id:      crypto.randomUUID(),
      timestamp:     new Date().toISOString().replace("T", " ").slice(0, 23),
      org_id:        "",
      project_id:    this.opts.project ?? "",
      project_name:  this.opts.project ?? "",
      team_id:       this.opts.team    ?? "",
      user_id:       "",
      environment:   this.opts.environment ?? "production",
      provider:      (output.llmOutput?.provider ?? inferProvider(model)) as string,
      model,
      input_tokens:  inputTokens,
      output_tokens: outputTokens,
      cached_tokens: cachedTokens,
      image_tokens:  0,
      audio_tokens:  0,
      text_tokens:   0,
      modalities:    "text",
      cost_usd:      calculateCost(model, inputTokens, outputTokens, cachedTokens),
      latency_ms:    latencyMs,
      status_code:   200,
      request_id:    requestId,
      tags,
    };

    void this._ship(event);
  }

  override async handleLLMError(err: Error, runId: string): Promise<void> {
    const latencyMs = Date.now() - (this.startTimes.get(runId) ?? Date.now());
    this.startTimes.delete(runId);

    const event = {
      event_id:      crypto.randomUUID(),
      timestamp:     new Date().toISOString().replace("T", " ").slice(0, 23),
      org_id:        "",
      project_id:    this.opts.project ?? "",
      project_name:  this.opts.project ?? "",
      team_id:       this.opts.team    ?? "",
      user_id:       "",
      environment:   this.opts.environment ?? "production",
      provider:      "unknown",
      model:         "unknown",
      input_tokens:  0,
      output_tokens: 0,
      cached_tokens: 0,
      image_tokens:  0,
      audio_tokens:  0,
      text_tokens:   0,
      modalities:    "text",
      cost_usd:      0,
      latency_ms:    latencyMs,
      status_code:   500,
      request_id:    "",
      tags:          { error: err.message.slice(0, 200) },
    };

    void this._ship(event);
  }

  override async handleChainStart(
    chain: Serialized,
    _inputs: ChainValues,
    runId: string,
  ): Promise<void> {
    const name = chain.id?.slice(-1)?.[0] as string | undefined;
    if (name) this.chainNames.set(runId, name);
  }

  override async handleChainEnd(_outputs: ChainValues, runId: string): Promise<void> {
    this.chainNames.delete(runId);
  }

  private async _ship(event: Record<string, unknown>): Promise<void> {
    try {
      await fetch(this.opts.ingestUrl ?? defaultIngestUrl(), {
        method: "POST",
        headers: {
          Authorization:  `Bearer ${this.opts.prismKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ events: [event] }),
      });
    } catch { /* Never propagate — observability must not break the caller */ }
  }
}

function inferProvider(model: string): string {
  const m = model.toLowerCase();
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3")) return "openai";
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gemini")) return "google";
  return "unknown";
}
