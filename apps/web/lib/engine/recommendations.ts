/**
 * Phase 1 — Enhanced recommendation engine.
 * Combines existing rule-based types with new pattern-aware types derived
 * from the feature × model cross-tab (getModelFeatureMatrix).
 */
import type { Recommendation, ModelFeatureRow } from "./types";
import type { ModelSpend, FeatureSpend, McpToolSpend, McpOverviewMetrics, AgentLoopRow } from "@/lib/tinybird/queries";
import { MODEL_PRICING, normalizeModelName as resolveModel } from "@/lib/pricing/table";
import { createHash } from "crypto";

// ── Helpers ───────────────────────────────────────────────────────────────────

function recId(type: string, ...parts: string[]): string {
  return createHash("md5").update([type, ...parts].join(":")).digest("hex").slice(0, 12);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Models with 128k+ context window (expensive large-context tier). */
const LARGE_CONTEXT_MODELS = new Set([
  "gpt-4-turbo", "gpt-4-turbo-preview", "gpt-4o", "gpt-4.1",
  "claude-3-opus-20240229", "claude-3-5-sonnet-20241022", "claude-sonnet-4-5",
  "gemini-1.5-pro", "gemini-pro-1.5",
]);

/** Models eligible for OpenAI batch API (50% cheaper). */
const BATCH_ELIGIBLE_PROVIDERS = new Set(["openai", "anthropic"]);

const DOWNGRADE_PAIRS: Record<string, string> = {
  "gpt-4-turbo":                "gpt-4o",
  "gpt-4-turbo-preview":        "gpt-4o",
  "gpt-4o":                     "gpt-4o-mini",
  "gpt-4.1":                    "gpt-4.1-mini",
  "claude-3-opus-20240229":     "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-20241022": "claude-3-5-haiku-20241022",
  "claude-sonnet-4-5":          "claude-haiku-4-5",
  "gemini-1.5-pro":             "gemini-1.5-flash",
};

/** Statistical significance threshold: require ≥50 requests to recommend. */
const MIN_REQUESTS = 50;
const MIN_COST_USD = 1.0;

// ── Confidence scoring ────────────────────────────────────────────────────────

function taskConfidence(row: ModelFeatureRow): number {
  let conf = 0;
  // Strong extraction signal: low output/input + high cache hit
  if (row.output_input_ratio < 0.3 && row.cache_hit_rate > 0.5) conf += 0.4;
  else if (row.output_input_ratio < 0.5 && row.cache_hit_rate > 0.3) conf += 0.25;
  // Small inputs → simple tasks
  if (row.avg_input_tokens < 300) conf += 0.3;
  else if (row.avg_input_tokens < 600) conf += 0.15;
  // Low error rate → model is handling it fine (won't degrade on cheaper)
  if (row.error_rate < 0.02) conf += 0.2;
  else if (row.error_rate < 0.05) conf += 0.1;
  // Sample size bonus
  if (row.requests > 500) conf += 0.1;
  else if (row.requests > 100) conf += 0.05;
  return Math.min(conf, 1);
}

// ── Builder functions ─────────────────────────────────────────────────────────

export function buildRecommendations(
  modelSpend:    ModelSpend[],
  featureSpend:  FeatureSpend[],
  featureMatrix: ModelFeatureRow[],
  mcpTools:      McpToolSpend[],
  mcpOverview:   McpOverviewMetrics | null,
  agentLoops:    AgentLoopRow[],
): Recommendation[] {
  const recs: Recommendation[] = [];

  // ── 1. Global cheaper-model (existing logic, improved confidence) ─────────
  for (const row of modelSpend) {
    const resolved = resolveModel(row.model) ?? row.model;
    const cheaper  = DOWNGRADE_PAIRS[resolved];
    if (!cheaper) continue;

    const currentP = MODEL_PRICING[resolved];
    const cheaperP = MODEL_PRICING[cheaper];
    if (!currentP || !cheaperP) continue;
    if (row.total_cost_usd < MIN_COST_USD) continue;

    const savingFraction = ((currentP.input + currentP.output) - (cheaperP.input + cheaperP.output))
      / (currentP.input + currentP.output);
    const savings = row.total_cost_usd * savingFraction * 0.5;
    if (savings < 0.01) continue;

    recs.push({
      id:      recId("cheaper_model", resolved, cheaper),
      type:    "cheaper_model",
      title:   `Switch ${resolved} → ${cheaper}`,
      description: `You spent $${row.total_cost_usd.toFixed(2)} on ${resolved} in the last 30 days. Migrating non-critical tasks to ${cheaper} (${Math.round(savingFraction * 100)}% cheaper) could cut that spend in half.`,
      potential_savings_usd: round2(savings),
      confidence:    0.6,
      status:        "new",
      current_model: resolved,
      suggested_model: cheaper,
      stats: {
        requests:          row.requests,
        current_cost:      row.total_cost_usd,
        cache_hit_rate:    row.cache_hit_rate,
        error_rate:        row.error_rate,
        tokens_per_dollar: row.tokens_per_dollar,
      },
    });
  }

  // ── 2. Per-feature downgrade (new: feature-level precision) ──────────────
  const featureRecs = new Map<string, Recommendation>();
  for (const row of featureMatrix) {
    const resolved = resolveModel(row.model) ?? row.model;
    const cheaper  = DOWNGRADE_PAIRS[resolved];
    if (!cheaper) continue;
    if (row.requests < MIN_REQUESTS || row.cost_usd < MIN_COST_USD) continue;

    const currentP = MODEL_PRICING[resolved];
    const cheaperP = MODEL_PRICING[cheaper];
    if (!currentP || !cheaperP) continue;

    const savingFraction = ((currentP.input + currentP.output) - (cheaperP.input + cheaperP.output))
      / (currentP.input + currentP.output);
    const savings  = row.cost_usd * savingFraction * 0.6; // higher conf = higher factor
    const conf     = taskConfidence(row);
    if (savings < 0.5 || conf < 0.3) continue;

    const key = `${row.feature}:${resolved}`;
    const existing = featureRecs.get(key);
    if (!existing || savings > existing.potential_savings_usd) {
      featureRecs.set(key, {
        id:      recId("per_feature_downgrade", row.feature, resolved, cheaper),
        type:    "per_feature_downgrade",
        title:   `"${row.feature}": switch ${resolved} → ${cheaper}`,
        description: `${row.requests.toLocaleString()} calls on this feature show a ${(row.output_input_ratio).toFixed(2)} output/input ratio and ${Math.round(row.cache_hit_rate * 100)}% cache hit rate — patterns typical of ${row.output_input_ratio < 0.4 ? "extraction/classification" : "short-form generation"} tasks where ${cheaper} achieves parity.`,
        potential_savings_usd: round2(savings),
        confidence:    conf,
        status:        "new",
        current_model: resolved,
        suggested_model: cheaper,
        feature:       row.feature,
        stats: {
          requests:           row.requests,
          current_cost:       row.cost_usd,
          avg_input_tokens:   row.avg_input_tokens,
          p95_input_tokens:   row.p95_input_tokens,
          output_input_ratio: row.output_input_ratio,
          cache_hit_rate:     row.cache_hit_rate,
          error_rate:         row.error_rate,
        },
      });
    }
  }
  recs.push(...Array.from(featureRecs.values()));

  // ── 3. Task type mismatch (large model on simple extraction) ─────────────
  for (const row of featureMatrix) {
    if (!LARGE_CONTEXT_MODELS.has(resolveModel(row.model) ?? "")) continue;
    if (row.requests < MIN_REQUESTS || row.cost_usd < MIN_COST_USD) continue;
    // Simple extraction signal: very low output, high cache, short inputs
    if (row.output_input_ratio > 0.4) continue;
    if (row.cache_hit_rate < 0.4) continue;
    if (row.avg_input_tokens > 600) continue;
    // Don't double-count if already covered by per_feature_downgrade
    const alreadyCovered = recs.some(r => r.feature === row.feature && r.current_model === (resolveModel(row.model) ?? row.model));
    if (alreadyCovered) continue;

    const resolved = resolveModel(row.model) ?? row.model;
    recs.push({
      id:      recId("task_type_mismatch", row.feature, resolved),
      type:    "task_type_mismatch",
      title:   `"${row.feature}" uses ${resolved} for what looks like extraction`,
      description: `${(row.output_input_ratio * 100).toFixed(0)}% output/input ratio and ${Math.round(row.cache_hit_rate * 100)}% cache hit rate on ${row.requests.toLocaleString()} calls strongly suggests deterministic extraction. A smaller model would handle this at a fraction of the cost.`,
      potential_savings_usd: round2(row.cost_usd * 0.55),
      confidence:    taskConfidence(row),
      status:        "new",
      current_model: resolved,
      feature:       row.feature,
      stats: {
        requests:           row.requests,
        current_cost:       row.cost_usd,
        avg_input_tokens:   row.avg_input_tokens,
        output_input_ratio: row.output_input_ratio,
        cache_hit_rate:     row.cache_hit_rate,
      },
    });
  }

  // ── 4. Context window waste ───────────────────────────────────────────────
  for (const row of featureMatrix) {
    if (!LARGE_CONTEXT_MODELS.has(resolveModel(row.model) ?? "")) continue;
    if (row.p95_input_tokens > 4000) continue;   // actually using context
    if (row.requests < MIN_REQUESTS || row.cost_usd < MIN_COST_USD) continue;
    const resolved = resolveModel(row.model) ?? row.model;
    const cheaper  = DOWNGRADE_PAIRS[resolved];
    if (!cheaper) continue;

    recs.push({
      id:      recId("context_window_waste", row.feature, resolved),
      type:    "context_window_waste",
      title:   `"${row.feature}" pays for 128k context but uses p95 ${Math.round(row.p95_input_tokens).toLocaleString()} tokens`,
      description: `${resolved} supports large context windows but your 95th percentile input is only ${Math.round(row.p95_input_tokens).toLocaleString()} tokens. A model like ${cheaper} covers that range at significantly lower cost.`,
      potential_savings_usd: round2(row.cost_usd * 0.4),
      confidence:    0.75,
      status:        "new",
      current_model: resolved,
      suggested_model: cheaper,
      feature:       row.feature,
      stats: {
        requests:         row.requests,
        current_cost:     row.cost_usd,
        p95_input_tokens: row.p95_input_tokens,
      },
    });
  }

  // ── 5. Batch opportunity (50% savings on async features) ─────────────────
  for (const row of featureMatrix) {
    if (row.cost_usd < 50) continue;
    if (!BATCH_ELIGIBLE_PROVIDERS.has(row.provider)) continue;
    if (row.cache_hit_rate > 0.5) continue; // already caching well

    recs.push({
      id:      recId("batch_opportunity", row.feature, row.model),
      type:    "batch_opportunity",
      title:   `"${row.feature}" is a candidate for batch processing (50% cheaper)`,
      description: `This feature costs $${row.cost_usd.toFixed(2)}/month and shows no streaming requirements. Switching to ${row.provider === "openai" ? "OpenAI Batch API" : "Anthropic Message Batches"} cuts the cost in half for async workloads.`,
      potential_savings_usd: round2(row.cost_usd * 0.5),
      confidence:    0.55,
      status:        "new",
      current_model: row.model,
      feature:       row.feature,
      stats: { requests: row.requests, current_cost: row.cost_usd },
    });
  }

  // ── 6. Caching opportunity (existing, kept) ───────────────────────────────
  for (const row of modelSpend) {
    const resolved = resolveModel(row.model) ?? row.model;
    const pricing  = MODEL_PRICING[resolved];
    if (!pricing?.cached_input) continue;
    if (row.total_cost_usd < MIN_COST_USD) continue;
    if (row.input_tokens < 100_000) continue;

    recs.push({
      id:      recId("caching_opportunity", resolved),
      type:    "caching_opportunity",
      title:   `Enable prompt caching on ${resolved}`,
      description: `${resolved} supports caching at $${pricing.cached_input}/1M (vs $${pricing.input}/1M uncached). Caching repeated system prompts can reduce input costs by 50–90%.`,
      potential_savings_usd: round2(row.total_cost_usd * 0.3),
      confidence: 0.7,
      status: "new",
      current_model: resolved,
      stats: { current_cost: row.total_cost_usd, cache_hit_rate: row.cache_hit_rate },
    });
  }

  // ── 7. Cache adoption gap (existing, kept) ────────────────────────────────
  for (const row of modelSpend) {
    const resolved = resolveModel(row.model) ?? row.model;
    const pricing  = MODEL_PRICING[resolved];
    if (!pricing?.cached_input) continue;
    if (row.cache_hit_rate >= 0.3 || row.input_tokens < 50_000) continue;
    if (row.total_cost_usd < MIN_COST_USD) continue;

    const savings = row.input_tokens * (pricing.input - pricing.cached_input) / 1_000_000 * 0.4;
    if (savings < 0.01) continue;

    recs.push({
      id:      recId("cache_adoption_gap", resolved),
      type:    "cache_adoption_gap",
      title:   `Improve cache hit rate on ${resolved} (currently ${Math.round(row.cache_hit_rate * 100)}%)`,
      description: `Only ${Math.round(row.cache_hit_rate * 100)}% of your ${resolved} calls use cached tokens. Restructuring shared system prompts could save ~$${savings.toFixed(2)}/month.`,
      potential_savings_usd: round2(savings),
      confidence: 0.65,
      status: "new",
      current_model: resolved,
      stats: { current_cost: row.total_cost_usd, cache_hit_rate: row.cache_hit_rate },
    });
  }

  // ── 8. MCP: high error rate ───────────────────────────────────────────────
  for (const tool of mcpTools) {
    if (tool.total_calls < 10 || tool.error_rate <= 0.15) continue;
    const wasted = tool.cost_usd * tool.error_rate;
    recs.push({
      id:      recId("mcp_high_error_rate", tool.tool_name, tool.mcp_server_name),
      type:    "mcp_high_error_rate",
      title:   `Tool "${tool.tool_name}" failing ${Math.round(tool.error_rate * 100)}% of calls`,
      description: `"${tool.tool_name}" on server "${tool.mcp_server_name}" failed ${tool.error_count} of ${tool.total_calls} calls, wasting ~$${wasted.toFixed(4)}. Add retry logic or fix the underlying error.`,
      potential_savings_usd: round2(wasted),
      confidence: 0.9,
      status: "new",
      tool_name: tool.tool_name,
      mcp_server: tool.mcp_server_name,
    });
  }

  // ── 9. MCP: unreconciled costs ────────────────────────────────────────────
  if (mcpOverview && mcpOverview.total_tool_cost_usd > 10 && mcpOverview.reconciliation_rate < 0.2) {
    recs.push({
      id:      recId("mcp_unreconciled_costs"),
      type:    "mcp_unreconciled_costs",
      title:   `$${mcpOverview.total_tool_cost_usd.toFixed(2)} in tool costs are unvalidated estimates`,
      description: `Only ${Math.round(mcpOverview.reconciliation_rate * 100)}% of MCP tool costs are reconciled to actual billing. Connect AWS, Pinecone, or Qdrant in Settings → Integrations.`,
      potential_savings_usd: 0,
      confidence: 1,
      status: "new",
    });
  }

  // ── 10. MCP: agent loops ──────────────────────────────────────────────────
  const loopTotal = agentLoops.reduce((s, l) => s + l.cost_usd, 0);
  if (agentLoops.length > 0 && loopTotal > 1) {
    const worst = agentLoops.reduce((a, b) => b.cost_usd > a.cost_usd ? b : a);
    recs.push({
      id:      recId("mcp_agent_loops"),
      type:    "mcp_agent_loops",
      title:   `${agentLoops.length} agent session${agentLoops.length > 1 ? "s" : ""} entered a tool-call loop — $${loopTotal.toFixed(2)} wasted`,
      description: `Worst offender: "${worst.tool_name}" called ${worst.call_count}× in one session. Add \`maxToolCallsPerSession\` to your PrismMCP config to enforce a circuit breaker.`,
      potential_savings_usd: round2(loopTotal),
      confidence: 0.95,
      status: "new",
      tool_name: worst.tool_name,
    });
  }

  // ── 11. Feature cost concentration ───────────────────────────────────────
  if (featureSpend.length > 0) {
    const totalF = featureSpend.reduce((s, f) => s + f.cost_usd, 0);
    const top    = featureSpend[0];
    if (top && totalF > 0) {
      const pct = (top.cost_usd / totalF) * 100;
      if (pct > 60 && top.cost_usd > 5) {
        recs.push({
          id:      recId("feature_cost_concentration", top.feature),
          type:    "feature_cost_concentration",
          title:   `"${top.feature}" is ${Math.round(pct)}% of all tagged spend`,
          description: `$${top.cost_usd.toFixed(2)} at $${top.avg_cost_per_call.toFixed(6)}/call. This is your highest-leverage target — consider caching, prompt compression, or a cheaper model.`,
          potential_savings_usd: round2(top.cost_usd * 0.25),
          confidence: 0.8,
          status: "new",
          feature: top.feature,
          stats: { current_cost: top.cost_usd },
        });
      }
    }
  }

  // ── 12. Low efficiency model ──────────────────────────────────────────────
  if (modelSpend.length > 1) {
    const median = [...modelSpend]
      .filter(m => m.tokens_per_dollar > 0)
      .map(m => m.tokens_per_dollar)
      .sort((a, b) => a - b)
      [Math.floor(modelSpend.length / 2)] ?? 0;

    for (const row of modelSpend) {
      if (!median || row.tokens_per_dollar >= median * 0.5 || row.total_cost_usd < 5) continue;
      recs.push({
        id:      recId("low_efficiency_model", row.model),
        type:    "low_efficiency_model",
        title:   `${resolveModel(row.model) ?? row.model} delivers ${Math.round(row.tokens_per_dollar / 1000)}K tokens/$ (org avg: ${Math.round(median / 1000)}K)`,
        description: `This model is significantly below your org's median token efficiency. Review whether a more efficient model handles these calls.`,
        potential_savings_usd: round2(row.total_cost_usd * 0.3),
        confidence: 0.55,
        status: "new",
        current_model: resolveModel(row.model) ?? row.model,
        stats: { current_cost: row.total_cost_usd, tokens_per_dollar: row.tokens_per_dollar },
      });
    }
  }

  // ── 13. High error cost ───────────────────────────────────────────────────
  for (const row of modelSpend) {
    if (row.error_rate < 0.05 || row.error_count < 10) continue;
    const wasted = row.total_cost_usd * row.error_rate;
    if (wasted < 0.5) continue;
    recs.push({
      id:      recId("high_error_cost", row.model),
      type:    "high_error_cost",
      title:   `$${wasted.toFixed(2)} wasted on failed ${resolveModel(row.model) ?? row.model} calls`,
      description: `${Math.round(row.error_rate * 100)}% error rate (${row.error_count} failed calls). Investigate rate limits, context length overflow, or model availability.`,
      potential_savings_usd: round2(wasted),
      confidence: 0.85,
      status: "new",
      current_model: resolveModel(row.model) ?? row.model,
      stats: { error_rate: row.error_rate, current_cost: row.total_cost_usd },
    });
  }

  // Sort by savings DESC, deduplicate by id
  const seen = new Set<string>();
  return recs
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .sort((a, b) => b.potential_savings_usd - a.potential_savings_usd)
    .slice(0, 15);
}
