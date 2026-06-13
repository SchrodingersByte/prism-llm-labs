/**
 * GET /api/metrics/provider-health
 * Returns real-time latency and error rate per provider from Redis.
 * Used by the dashboard to show provider status.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { getMedianLatency, getErrorRate } from "@/lib/gateway/provider-health";

const PROVIDERS  = ["openai", "anthropic", "google"] as const;
const TOP_MODELS: Record<string, string[]> = {
  openai:    ["gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
  google:    ["gemini-1.5-pro", "gemini-1.5-flash"],
};

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const results = await Promise.all(
    PROVIDERS.map(async provider => {
      const models = TOP_MODELS[provider] ?? [];
      const [errorRate, ...latencies] = await Promise.all([
        getErrorRate(provider),
        ...models.map(m => getMedianLatency(provider, m)),
      ]);

      const modelLatencies = models.map((m, i) => ({
        model:      m,
        latency_ms: latencies[i] === 9999 ? null : latencies[i],
      })).filter(m => m.latency_ms !== null);

      return {
        provider,
        error_rate:    Number(errorRate.toFixed(4)),
        status:        errorRate > 0.1 ? "degraded" : errorRate > 0 ? "warning" : "ok",
        model_latencies: modelLatencies,
      };
    })
  );

  return NextResponse.json({ data: results });
}
