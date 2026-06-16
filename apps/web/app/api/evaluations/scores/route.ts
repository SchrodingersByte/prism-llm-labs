/**
 * /api/evaluations/scores
 *
 * GET — aggregated score data for the Model Arena scatter chart.
 *
 * Returns per-model averages:
 *   { model, avg_score, pass_rate, sample_count, avg_cost_usd, efficiency }
 *
 * Also accepts:
 *   ?eval_run_id=...        drill into a specific run (raw scores)
 *   ?run_ids=a,b,c          compare 2+ experiment runs side by side (PRD-2):
 *                           per-run quality + cost + per-scorer breakdown +
 *                           deltas vs the baseline run + a regression flag.
 *
 * POST — record individual eval scores (called by the scorer engine or
 *        by external integrations sending human feedback).
 */

import { NextRequest, NextResponse }        from "next/server";
import { z }                                from "zod";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { createAdminClient }                from "@/lib/supabase/server";
import { canWriteOrg }                       from "@/lib/supabase/metrics-scope";

export const runtime = "nodejs";

// ── GET — aggregated model scores for Arena ───────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const url       = new URL(req.url);
  const evalRunId = url.searchParams.get("eval_run_id") ?? undefined;
  const runIdsRaw = url.searchParams.get("run_ids") ?? undefined;
  const regThresh = Number(url.searchParams.get("regression_threshold") ?? 0.05);
  const limit     = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);

  const admin = createAdminClient();

  // ── Compare 2+ experiment runs (PRD-2) ────────────────────────────────────
  if (runIdsRaw) {
    const runIds = runIdsRaw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 10);
    if (runIds.length === 0) return NextResponse.json({ compare: [] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: runs } = await (admin as any)
      .from("evaluation_runs")
      .select("id, name, status, overall_score, n_samples, edge_cases, cost_usd, config_snapshot, baseline_run_id")
      .eq("org_id", member.org_id)
      .in("id", runIds);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: scoreRows } = await (admin as any)
      .from("eval_scores")
      .select("eval_run_id, scorer_type, score, passed")
      .eq("org_id", member.org_id)
      .in("eval_run_id", runIds);

    // Per-run, per-scorer breakdown.
    type Agg = { sum: number; pass: number; n: number };
    const byRun = new Map<string, Map<string, Agg>>();
    for (const r of (scoreRows ?? []) as Array<{ eval_run_id: string; scorer_type: string; score: number | null; passed: boolean | null }>) {
      if (r.score == null) continue;
      if (!byRun.has(r.eval_run_id)) byRun.set(r.eval_run_id, new Map());
      const m = byRun.get(r.eval_run_id)!;
      if (!m.has(r.scorer_type)) m.set(r.scorer_type, { sum: 0, pass: 0, n: 0 });
      const a = m.get(r.scorer_type)!;
      a.sum += Number(r.score); a.n++; if (r.passed) a.pass++;
    }

    // Baseline = a run referenced as baseline_run_id by another run in the set, else the first.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runList = (runs ?? []) as any[];
    const ordered = runIds.map(id => runList.find(r => r.id === id)).filter(Boolean);
    const referenced = ordered.find(r => r.baseline_run_id && runIds.includes(r.baseline_run_id))?.baseline_run_id;
    const baselineId = referenced ?? ordered[0]?.id ?? null;
    const baseline   = ordered.find(r => r.id === baselineId) ?? ordered[0] ?? null;
    const baseScore  = baseline?.overall_score != null ? Number(baseline.overall_score) : null;
    const baseCost   = baseline?.cost_usd != null ? Number(baseline.cost_usd) : null;

    const compare = ordered.map(r => {
      const scorerAgg = byRun.get(r.id) ?? new Map<string, Agg>();
      const scorers: Record<string, { avg_score: number; pass_rate: number; count: number }> = {};
      for (const [st, a] of Array.from(scorerAgg.entries())) {
        scorers[st] = {
          avg_score: Math.round((a.sum / a.n) * 10000) / 10000,
          pass_rate: Math.round((a.pass / a.n) * 10000) / 10000,
          count:     a.n,
        };
      }
      const score = r.overall_score != null ? Number(r.overall_score) : null;
      const cost  = r.cost_usd != null ? Number(r.cost_usd) : null;
      const isBaseline  = r.id === baselineId;
      const scoreDelta  = score != null && baseScore != null && !isBaseline ? Math.round((score - baseScore) * 10000) / 10000 : null;
      const costDelta   = cost  != null && baseCost  != null && !isBaseline ? Math.round((cost - baseCost) * 1_000_000) / 1_000_000 : null;
      const passRate    = r.n_samples ? Math.round(((r.n_samples - (r.edge_cases ?? 0)) / r.n_samples) * 10000) / 10000 : null;
      return {
        run_id:       r.id,
        name:         r.name ?? null,
        model:        r.config_snapshot?.model ?? null,
        status:       r.status,
        overall_score: score,
        pass_rate:    passRate,
        sample_count: r.n_samples ?? 0,
        edge_cases:   r.edge_cases ?? 0,
        cost_usd:     cost,
        scorers,
        is_baseline:  isBaseline,
        score_delta:  scoreDelta,
        cost_delta:   costDelta,
        regression:   scoreDelta != null && scoreDelta < -Math.abs(regThresh),
      };
    });

    return NextResponse.json({ compare, baseline_run_id: baselineId });
  }

  // If a specific run is requested, return raw scores for that run
  if (evalRunId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any)
      .from("eval_scores")
      .select("id, model, judge_model, scorer_type, score, passed, reason, cost_usd, latency_ms, trace_id, span_id, created_at")
      .eq("org_id", member.org_id)
      .eq("eval_run_id", evalRunId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return NextResponse.json({ error: "Failed to fetch scores" }, { status: 500 });
    return NextResponse.json({ scores: data ?? [] });
  }

  // Default: aggregate by model for the Arena chart
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("eval_scores")
    .select("model, score, passed, cost_usd")
    .eq("org_id", member.org_id)
    .not("model", "is", null)
    .not("score", "is", null);

  if (error) return NextResponse.json({ error: "Failed to fetch scores" }, { status: 500 });

  // Aggregate client-side (simpler than a raw SQL group-by via admin client)
  type RawScore = { model: string; score: number; passed: boolean | null; cost_usd: number | null };
  const grouped = new Map<string, { scores: number[]; passed: number; total: number; costs: number[] }>();

  for (const row of (data ?? []) as RawScore[]) {
    if (!row.model || row.score == null) continue;
    if (!grouped.has(row.model)) grouped.set(row.model, { scores: [], passed: 0, total: 0, costs: [] });
    const g = grouped.get(row.model)!;
    g.scores.push(Number(row.score));
    g.total++;
    if (row.passed) g.passed++;
    if (row.cost_usd != null) g.costs.push(Number(row.cost_usd));
  }

  const arena = Array.from(grouped.entries()).map(([model, g]) => {
    const avg_score  = g.scores.reduce((s, v) => s + v, 0) / g.scores.length;
    const avg_cost   = g.costs.length ? g.costs.reduce((s, v) => s + v, 0) / g.costs.length : null;
    // efficiency = quality / cost_per_1k_calls (higher is better)
    const efficiency = avg_cost && avg_cost > 0 ? avg_score / (avg_cost * 1000) : null;
    return {
      model,
      avg_score:    Math.round(avg_score * 10000) / 10000,
      pass_rate:    Math.round((g.passed / g.total) * 10000) / 10000,
      sample_count: g.total,
      avg_cost_usd: avg_cost != null ? Math.round(avg_cost * 10_000_000) / 10_000_000 : null,
      efficiency:   efficiency != null ? Math.round(efficiency * 100) / 100 : null,
    };
  });

  return NextResponse.json({ arena });
}

// ── POST — record scores (batch) ───────────────────────────────────────────────

const ScoreRowSchema = z.object({
  eval_run_id: z.string().uuid().optional(),
  trace_id:    z.string().optional(),
  span_id:     z.string().optional(),
  model:       z.string().min(1),
  judge_model: z.string().optional(),
  scorer_type: z.enum(["llm_judge", "rule", "human"]).default("llm_judge"),
  score:       z.number().min(0).max(1),
  passed:      z.boolean().optional(),
  reason:      z.string().max(2000).optional(),
  cost_usd:    z.number().min(0).optional(),
  latency_ms:  z.number().int().min(0).optional(),
});

const BatchScoreSchema = z.object({
  scores: z.array(ScoreRowSchema).min(1).max(200),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await canWriteOrg(user.id, member.org_id))) {
    return NextResponse.json({ error: "Read-only members cannot record scores" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = BatchScoreSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });
  }

  const rows = parsed.data.scores.map(s => ({
    ...s,
    org_id: member.org_id,
  }));

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("eval_scores")
    .insert(rows)
    .select("id");

  if (error) return NextResponse.json({ error: "Failed to record scores" }, { status: 500 });

  return NextResponse.json({ inserted: (data ?? []).length }, { status: 201 });
}
