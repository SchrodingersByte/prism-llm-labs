/**
 * Engine driver — the single compute+persist entry point for the Model
 * Intelligence Engine, shared by the on-read API route
 * (GET /api/engine/recommendations) and the scheduled cron
 * (GET /api/cron/build-recommendations).
 *
 * buildRecommendations() in recommendations.ts is pure: it takes six Tinybird
 * spend/usage slices and returns Recommendation[]. This module wraps it with
 * (a) the Tinybird fetch and (b) the recommendation_actions persistence that
 * was previously reachable ONLY by loading the API route. The cron can now
 * drive the engine without the (currently stubbed) dashboard UI ever being
 * opened — closing the D3 gap where "UI dead → API never hit →
 * recommendation_actions stays empty → no substitution is ever active".
 */
import {
  getSpendByModel, getSpendByMcpTool, getMcpOverviewMetrics,
  getAgentLoops, getSpendByFeature, getModelFeatureMatrix,
} from "@/lib/tinybird/queries";
import { buildRecommendations } from "./recommendations";
import { getRecommendationActions, upsertRecommendationAction } from "./actions";
import type { Recommendation } from "./types";

export interface EngineComputeResult {
  recommendations: Recommendation[];
  // Inferred from the query fn so we don't duplicate the ModelSpend type import;
  // the API route needs this slice for computeEfficiencyScore().
  modelSpend:      Awaited<ReturnType<typeof getSpendByModel>>;
}

/** Trailing-30-day window, matching the API route's existing bounds exactly. */
function last30dRange(): { from: string; to: string } {
  const from = (() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10) + " 00:00:00";
  })();
  const to = new Date().toISOString().slice(0, 10) + " 23:59:59";
  return { from, to };
}

/**
 * Fetch the six Tinybird slices for an org and build its recommendations.
 * Each source fails soft to an empty result (mirrors the API route), so a
 * single pipe outage degrades to fewer recommendations rather than an error.
 */
export async function computeRecommendations(orgId: string): Promise<EngineComputeResult> {
  const { from, to } = last30dRange();
  const [modelSpend, featureSpend, featureMatrix, mcpTools, mcpOverview, agentLoops] =
    await Promise.all([
      getSpendByModel(orgId, from).catch(() => []),
      getSpendByFeature(orgId, from, to).catch(() => []),
      getModelFeatureMatrix(orgId, from, to).catch(() => []),
      getSpendByMcpTool(orgId, from, to).catch(() => []),
      getMcpOverviewMetrics(orgId, from, to).catch(() => null),
      getAgentLoops(orgId, from, to).catch(() => []),
    ]);

  const recommendations = buildRecommendations(
    modelSpend, featureSpend, featureMatrix, mcpTools, mcpOverview, agentLoops,
  );
  return { recommendations, modelSpend };
}

/**
 * Seed a persisted recommendation_actions row (status 'new') for every freshly
 * computed recommendation that does NOT already have one.
 *
 * Crucially it does NOT touch existing rows: a recommendation a human has
 * already validated, staged, applied, or rejected keeps its lifecycle status
 * and timestamps. This has-check is what lets the cron run daily without ever
 * resetting an active model substitution back to 'new' — a blind upsert of
 * every fresh rec would silently disable applied substitutions on the gateway.
 *
 * Returns the number of brand-new rows seeded.
 */
export async function persistNewRecommendations(
  orgId: string,
  recs:  readonly Recommendation[],
): Promise<number> {
  const persisted = await getRecommendationActions(orgId);
  let seeded = 0;
  for (const rec of recs) {
    if (persisted.has(rec.id)) continue;   // preserve existing lifecycle — never clobber
    const saved = await upsertRecommendationAction({
      orgId,
      rec: {
        id:              rec.id,
        type:            rec.type,
        title:           rec.title,
        current_model:   rec.current_model   ?? null,
        suggested_model: rec.suggested_model ?? null,
        feature:         rec.feature         ?? null,
      },
      status: "new",
    });
    if (saved) seeded++;
  }
  return seeded;
}

/**
 * Cron entry point: compute an org's recommendations from Tinybird and seed any
 * new ones into recommendation_actions. Returns a small summary for the cron's
 * response body.
 */
export async function computeAndPersistRecommendations(
  orgId: string,
): Promise<{ computed: number; seeded: number }> {
  const { recommendations } = await computeRecommendations(orgId);
  const seeded = await persistNewRecommendations(orgId, recommendations);
  return { computed: recommendations.length, seeded };
}
