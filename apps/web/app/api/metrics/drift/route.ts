/**
 * /api/metrics/drift (PRD-5)
 *
 * GET — drift trend + topic clusters for the org (org member, read-only).
 *   ?segment=all|model|feature  (default all)
 *   ?segment_value=<model>       (optional)
 *   ?metric=psi|js|centroid_cosine (optional — omit for all three)
 *   ?days=30                     (look-back, default 30)
 * Returns { metrics: [...], latest: {psi,js,centroid_cosine}, clusters: [...] }.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const url          = new URL(req.url);
  const segment      = url.searchParams.get("segment") ?? "all";
  const segmentValue = url.searchParams.get("segment_value") ?? undefined;
  const metric       = url.searchParams.get("metric") ?? undefined;
  const days         = Math.min(Number(url.searchParams.get("days") ?? 30), 180);
  const since        = new Date(Date.now() - days * 86_400_000).toISOString();

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (admin as any)
    .from("drift_metrics")
    .select("window_start, window_end, segment, segment_value, metric, value, sample_size, baseline_ref, computed_at")
    .eq("org_id", member.org_id)
    .eq("segment", segment)
    .gte("computed_at", since)
    .order("computed_at", { ascending: true })
    .limit(2000);
  if (segmentValue) q = q.eq("segment_value", segmentValue);
  if (metric)       q = q.eq("metric", metric);

  const { data: metrics, error } = await q;
  if (error) return NextResponse.json({ error: "Failed to fetch drift" }, { status: 500 });

  // Latest value per metric (most-recent computed_at wins).
  const latest: Record<string, number> = {};
  const seenAt: Record<string, number> = {};
  for (const r of (metrics ?? []) as { metric: string; value: number; computed_at: string }[]) {
    const t = new Date(r.computed_at).getTime();
    if (seenAt[r.metric] === undefined || t >= seenAt[r.metric]) { latest[r.metric] = Number(r.value); seenAt[r.metric] = t; }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: clusters } = await (admin as any)
    .from("clusters")
    .select("id, label, size, keywords, window_start, window_end, created_at")
    .eq("org_id", member.org_id)
    .order("created_at", { ascending: false })
    .order("size", { ascending: false })
    .limit(50);

  return NextResponse.json({ metrics: metrics ?? [], latest, clusters: clusters ?? [] });
}
