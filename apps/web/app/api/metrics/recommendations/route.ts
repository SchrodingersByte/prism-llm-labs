import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getSpendByModel, getSpendByMcpTool, getMcpOverviewMetrics, getAgentLoops, getSpendByFeature } from "@/lib/tinybird/queries";
import { MODEL_PRICING } from "@/lib/pricing/table";

interface Recommendation {
  type:        "cheaper_model" | "caching_opportunity" | "high_cost_model"
             | "mcp_high_error_rate" | "mcp_unreconciled_costs" | "mcp_agent_loops"
             | "cache_adoption_gap" | "low_efficiency_model" | "feature_cost_concentration"
             | "high_error_cost";
  title:       string;
  description: string;
  potential_savings_usd: number;
  current_model?:   string;
  suggested_model?: string;
  tool_name?:       string;
  mcp_server?:      string;
  feature?:         string;
}

export async function GET() {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (admin as any)
    .from("organizations")
    .select("plan, subscription_status")
    .eq("id", ctx.orgId)
    .single() as { data: { plan: string; subscription_status: string } | null };

  if (!org || !["active", "trialing"].includes(org.subscription_status)) {
    return NextResponse.json({ error: "Upgrade to access recommendations" }, { status: 403 });
  }

  const thirtyDaysAgo = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10) + " 00:00:00";
  })();

  const today = new Date().toISOString().slice(0, 10) + " 23:59:59";

  const [modelSpend, mcpTools, mcpOverview, agentLoops, featureSpend] = await Promise.all([
    getSpendByModel(ctx.orgId, thirtyDaysAgo),
    getSpendByMcpTool(ctx.orgId, thirtyDaysAgo, today),
    getMcpOverviewMetrics(ctx.orgId, thirtyDaysAgo, today),
    getAgentLoops(ctx.orgId, thirtyDaysAgo, today),
    getSpendByFeature(ctx.orgId, thirtyDaysAgo, today),
  ]);

  const recommendations: Recommendation[] = [];

  const downgradePairs: Record<string, string> = {
    "gpt-4-turbo":                "gpt-4o",
    "gpt-4-turbo-preview":        "gpt-4o",
    "gpt-4o":                     "gpt-4o-mini",
    "claude-3-opus-20240229":     "claude-3-5-sonnet-20241022",
    "claude-3-5-sonnet-20241022": "claude-3-5-haiku-20241022",
  };

  for (const row of modelSpend) {
    const cheaper = downgradePairs[row.model];
    if (!cheaper) continue;

    const currentPricing = MODEL_PRICING[row.model];
    const cheaperPricing = MODEL_PRICING[cheaper];
    if (!currentPricing || !cheaperPricing) continue;

    const currentCostPer1M = currentPricing.input + currentPricing.output;
    const cheaperCostPer1M = cheaperPricing.input + cheaperPricing.output;
    const savingsFraction = (currentCostPer1M - cheaperCostPer1M) / currentCostPer1M;
    const potentialSavings = row.total_cost_usd * savingsFraction * 0.5;

    if (potentialSavings > 0.01) {
      recommendations.push({
        type:                    "cheaper_model",
        title:                   `Consider ${cheaper} instead of ${row.model}`,
        description:             `You spent $${row.total_cost_usd.toFixed(2)} on ${row.model} in the last 30 days. Migrating non-critical tasks to ${cheaper} could reduce costs significantly.`,
        potential_savings_usd:   Math.round(potentialSavings * 100) / 100,
        current_model:           row.model,
        suggested_model:         cheaper,
      });
    }

    if (row.total_cost_usd > 1 && currentPricing.cached_input !== undefined && row.input_tokens > 100_000) {
      recommendations.push({
        type:                  "caching_opportunity",
        title:                 `Enable prompt caching for ${row.model}`,
        description:           `${row.model} supports prompt caching at ${currentPricing.cached_input}x the input price. Caching repeated system prompts can reduce costs by up to 90%.`,
        potential_savings_usd: Math.round(row.total_cost_usd * 0.3 * 100) / 100,
        current_model:         row.model,
      });
    }
  }

  // ── MCP: high tool error rate ─────────────────────────────────────────────
  for (const tool of mcpTools) {
    if (tool.total_calls < 10) continue;  // ignore low-volume tools
    if (tool.error_rate > 0.15) {
      const wastedCost = tool.cost_usd * tool.error_rate;
      recommendations.push({
        type:                  "mcp_high_error_rate",
        title:                 `Tool "${tool.tool_name}" is failing ${(tool.error_rate * 100).toFixed(0)}% of calls`,
        description:           `"${tool.tool_name}" on server "${tool.mcp_server_name}" failed ${tool.error_count} of ${tool.total_calls} calls, wasting an estimated $${wastedCost.toFixed(4)} in failed executions. Add retry logic or fix the underlying error.`,
        potential_savings_usd: Math.round(wastedCost * 100) / 100,
        tool_name:             tool.tool_name,
        mcp_server:            tool.mcp_server_name,
      });
    }
  }

  // ── MCP: unreconciled tool costs ──────────────────────────────────────────
  if (mcpOverview && mcpOverview.total_tool_cost_usd > 10 && mcpOverview.reconciliation_rate < 0.2) {
    recommendations.push({
      type:                  "mcp_unreconciled_costs",
      title:                 `$${mcpOverview.total_tool_cost_usd.toFixed(2)} in tool costs are unvalidated estimates`,
      description:           `Only ${(mcpOverview.reconciliation_rate * 100).toFixed(0)}% of your MCP tool costs have been reconciled to actual infrastructure billing. Connect an AWS, Pinecone, or Qdrant account in Settings → Connections to validate actuals.`,
      potential_savings_usd: 0,
    });
  }

  // ── MCP: agent loop cost ──────────────────────────────────────────────────
  const loopTotal = agentLoops.reduce((s, l) => s + l.cost_usd, 0);
  if (agentLoops.length > 0 && loopTotal > 1) {
    const worstLoop = agentLoops.reduce((a, b) => b.cost_usd > a.cost_usd ? b : a);
    recommendations.push({
      type:                  "mcp_agent_loops",
      title:                 `${agentLoops.length} agent session${agentLoops.length > 1 ? "s" : ""} entered a tool-call loop — costing $${loopTotal.toFixed(4)}`,
      description:           `Worst offender: tool "${worstLoop.tool_name}" called ${worstLoop.call_count}× in session ${worstLoop.session_id.slice(0, 8)}…. Add \`maxToolCallsPerSession\` to your PrismMCP config to enforce a circuit breaker.`,
      potential_savings_usd: Math.round(loopTotal * 100) / 100,
      tool_name:             worstLoop.tool_name,
    });
  }

  // ── Cache adoption gap (Unit Economics: efficiency) ──────────────────────
  const orgTotalInputCached = modelSpend.reduce((s, m) => s + m.input_tokens + m.cached_tokens, 0);
  for (const row of modelSpend) {
    const pricing = MODEL_PRICING[row.model];
    if (!pricing?.cached_input) continue;           // model doesn't support caching
    if (row.cache_hit_rate >= 0.3) continue;         // already caching reasonably well
    if (row.input_tokens < 50_000) continue;         // too few tokens to matter
    if (row.total_cost_usd < 1) continue;

    const potentialSavings = row.input_tokens
      * (pricing.input - pricing.cached_input) / 1_000_000 * 0.4; // assume 40% cacheable
    if (potentialSavings < 0.01) continue;

    recommendations.push({
      type:                  "cache_adoption_gap",
      title:                 `Enable prompt caching on ${row.model} (currently ${(row.cache_hit_rate * 100).toFixed(0)}% hit rate)`,
      description:           `Only ${(row.cache_hit_rate * 100).toFixed(0)}% of your ${row.model} calls use cached tokens. Restructuring shared system prompts could save ~$${potentialSavings.toFixed(2)}/month. Cached input costs $${pricing.cached_input}/1M vs $${pricing.input}/1M uncached.`,
      potential_savings_usd: Math.round(potentialSavings * 100) / 100,
      current_model:         row.model,
    });
  }

  // ── Low efficiency model ──────────────────────────────────────────────────
  if (modelSpend.length > 1) {
    const orgMedianTpd = modelSpend
      .filter(m => m.tokens_per_dollar > 0)
      .map(m => m.tokens_per_dollar)
      .sort((a, b) => a - b)[Math.floor(modelSpend.length / 2)] ?? 0;

    for (const row of modelSpend) {
      if (orgMedianTpd === 0 || row.tokens_per_dollar === 0) continue;
      if (row.tokens_per_dollar >= orgMedianTpd * 0.5) continue;  // within 50% of median
      if (row.total_cost_usd < 5) continue;

      recommendations.push({
        type:                  "low_efficiency_model",
        title:                 `${row.model} delivers ${Math.round(row.tokens_per_dollar / 1000)}K tokens/$ vs org avg ${Math.round(orgMedianTpd / 1000)}K`,
        description:           `${row.model} is significantly below your org's median token efficiency. This may indicate prompt bloat or an overpowered model for the task. Review whether a more efficient model handles these calls.`,
        potential_savings_usd: Math.round(row.total_cost_usd * 0.3 * 100) / 100,
        current_model:         row.model,
      });
    }
  }
  void orgTotalInputCached; // suppress unused warning

  // ── Feature cost concentration ────────────────────────────────────────────
  if (featureSpend.length > 0) {
    const totalFeatureCost = featureSpend.reduce((s, f) => s + f.cost_usd, 0);
    const top = featureSpend[0];
    if (top && totalFeatureCost > 0) {
      const pct = (top.cost_usd / totalFeatureCost) * 100;
      if (pct > 60 && top.cost_usd > 5) {
        recommendations.push({
          type:                  "feature_cost_concentration",
          title:                 `Feature "${top.feature}" accounts for ${pct.toFixed(0)}% of tagged spend`,
          description:           `"${top.feature}" costs $${top.cost_usd.toFixed(2)} (${pct.toFixed(0)}% of all feature-tagged spend) at $${top.avg_cost_per_call.toFixed(6)}/call. This is your highest-leverage optimization target — consider caching, prompt compression, or a cheaper model.`,
          potential_savings_usd: Math.round(top.cost_usd * 0.25 * 100) / 100,
          feature:               top.feature,
        });
      }
    }
  }

  // ── High error cost (per model) ───────────────────────────────────────────
  for (const row of modelSpend) {
    if (row.error_rate < 0.05 || row.error_count < 10) continue;
    const wastedCost = row.total_cost_usd * row.error_rate;
    if (wastedCost < 0.5) continue;
    recommendations.push({
      type:                  "high_error_cost",
      title:                 `$${wastedCost.toFixed(2)} wasted on failed ${row.model} calls`,
      description:           `${row.model} has a ${(row.error_rate * 100).toFixed(1)}% error rate (${row.error_count} failed calls). Investigate rate limits, context length overflow, or model availability issues.`,
      potential_savings_usd: Math.round(wastedCost * 100) / 100,
      current_model:         row.model,
    });
  }

  recommendations.sort((a, b) => b.potential_savings_usd - a.potential_savings_usd);

  return NextResponse.json({ data: recommendations.slice(0, 10) });
}
