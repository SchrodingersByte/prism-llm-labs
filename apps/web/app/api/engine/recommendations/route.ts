import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { computeRecommendations } from "@/lib/engine/run";
import { computeEfficiencyScore } from "@/lib/engine/scoring";
import { batchGetNarratives } from "@/lib/engine/narratives";
import { overlayRecommendationActions } from "@/lib/engine/actions";
import { checkFeature } from "@/lib/billing/feature-guard";

export async function GET() {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const guard = await checkFeature(ctx.orgId, "engine");
  if (guard) return guard;

  // Fetch Tinybird slices + build recommendations via the shared engine driver
  // (identical logic to what the build-recommendations cron runs).
  const { recommendations, modelSpend } = await computeRecommendations(ctx.orgId);

  // Generate narratives for top 5 recommendations (others load on demand)
  const top5 = recommendations.slice(0, 5);
  const narrativeMap: Record<string, string> = await batchGetNarratives(ctx.orgId, top5).catch(() => ({} as Record<string, string>));

  // Overlay persisted lifecycle state — see overlayRecommendationActions() for
  // why this needs to be centralised (both this route and the server-rendered
  // /dashboard/engine page recompute Recommendation[] fresh from Tinybird on
  // every load, and neither has any memory of its own without this merge).
  const recsWithNarratives = await overlayRecommendationActions(
    ctx.orgId,
    recommendations.map(r => ({ ...r, narrative: narrativeMap[r.id] ?? null })),
  );

  // Adoption rate — computeEfficiencyScore's 4th component — needs the *real*,
  // persisted count of activated recommendations. This used to query
  // recommendation_narratives for a narrative === "APPLIED" sentinel that
  // nothing in the codebase has ever written (appliedCount was permanently 0,
  // and so was this component of every org's efficiency score). The overlay
  // above is the actual source of truth for lifecycle status — derive it from
  // there instead, the same way the server-rendered /dashboard/engine page does.
  const appliedCount = recsWithNarratives.filter(r => r.status === "applied").length;
  const efficiency   = computeEfficiencyScore(modelSpend, appliedCount, recommendations.length);

  return NextResponse.json({
    recommendations: recsWithNarratives,
    efficiency,
    total_potential_savings: recommendations.reduce((s, r) => s + r.potential_savings_usd, 0),
    generated_at: new Date().toISOString(),
  });
}
