/**
 * /api/metrics/quality (PRD-1, P1.6)
 *
 * GET — online-eval quality for the org: daily trend + per-model + per-scorer
 * breakdown, read from the Tinybird quality pipes (fed by the eval_score_events
 * mirror written by the run-online-evals sampler).
 *   ?days=30  ?project_id=  ?scorer_type=  ?model=
 * Org member, read-only. The Quality dashboard (deferred UI) consumes this.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { queryTinybird } from "@/lib/tinybird/client";

export const runtime = "nodejs";

const tb = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const url        = new URL(req.url);
  const days       = Math.min(Number(url.searchParams.get("days") ?? 30), 180);
  const projectId  = url.searchParams.get("project_id") ?? "";
  const scorerType = url.searchParams.get("scorer_type") ?? "";
  const model      = url.searchParams.get("model") ?? "";
  const from       = tb(new Date(Date.now() - days * 86_400_000));
  const to         = tb(new Date());

  const base: Record<string, string> = { org_id: member.org_id, from_date: from, to_date: to };
  if (projectId) base.project_id = projectId;

  try {
    const [timeseries, byModel, byScorer] = await Promise.all([
      queryTinybird("quality_timeseries", { ...base, ...(scorerType ? { scorer_type: scorerType } : {}), ...(model ? { model } : {}) }),
      queryTinybird("quality_by_model",   { ...base, ...(scorerType ? { scorer_type: scorerType } : {}) }),
      queryTinybird("quality_by_scorer",  { ...base, ...(model ? { model } : {}) }),
    ]);

    const ts          = timeseries as { date: string; scores: number; avg_score: number; pass_rate: number }[];
    const latest      = ts.length ? ts[ts.length - 1] : null;
    const totalScores = ts.reduce((s, r) => s + (r.scores ?? 0), 0);

    return NextResponse.json({
      timeseries:   ts,
      by_model:     byModel,
      by_scorer:    byScorer,
      latest:       latest ? { date: latest.date, avg_score: latest.avg_score, pass_rate: latest.pass_rate } : null,
      total_scores: totalScores,
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch quality metrics" }, { status: 500 });
  }
}
