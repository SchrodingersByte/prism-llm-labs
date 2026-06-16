/**
 * Cron: embedding-drift + topic clustering (PRD-5).
 *
 * For each org with captured embeddings (content_embeddings, PRD-0): pull a
 * baseline window + a current window, compute PSI / JS / centroid-cosine drift
 * (overall + per top model) into drift_metrics, and cluster the current window
 * into topic `clusters`. Heavy work — cron + sampling only, never inline.
 * A `drift` alert (lib/alerts/evaluator) fires off the rows written here.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { computeEmbeddingDrift, type Vec } from "@/lib/drift/metrics";
import { kMeans, nearestToCentroid } from "@/lib/drift/cluster";

export const runtime     = "nodejs";
export const maxDuration = 300;

const CURRENT_DAYS  = 7;
const BASELINE_DAYS = 30;   // baseline window precedes the current window
const SAMPLE_CAP    = 500;
const MIN_SAMPLES   = 30;   // need this many in BOTH windows to score a segment
const CLUSTER_K     = 5;
const CLUSTER_CAP   = 300;
const TOP_MODELS    = 5;

/** pgvector comes back as a "[..]" string (or already an array) — normalize to number[]. */
function parseVec(v: unknown): Vec | null {
  if (Array.isArray(v)) return v.map(Number);
  if (typeof v === "string") {
    try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(Number) : null; } catch { return null; }
  }
  return null;
}

interface EmbRow { event_id: string; model: string; vec: Vec }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pullWindow(admin: any, orgId: string, startIso: string, endIso: string): Promise<EmbRow[]> {
  const { data } = await admin
    .from("content_embeddings")
    .select("event_id, model, embedding")
    .eq("org_id", orgId)
    .eq("kind", "prompt")
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: false })
    .limit(SAMPLE_CAP);
  const rows: EmbRow[] = [];
  for (const r of (data ?? []) as { event_id: string; model: string; embedding: unknown }[]) {
    const vec = parseVec(r.embedding);
    if (vec && vec.length > 0) rows.push({ event_id: r.event_id, model: r.model, vec });
  }
  return rows;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function driftRows(orgId: string, segment: string, segmentValue: string | null, d: ReturnType<typeof computeEmbeddingDrift>, win: { start: string; end: string }): any[] {
  const base = { org_id: orgId, segment, segment_value: segmentValue, window_start: win.start, window_end: win.end, baseline_ref: `${BASELINE_DAYS}d`, sample_size: d.current_n, computed_at: new Date().toISOString() };
  return [
    { ...base, metric: "psi",             value: d.psi },
    { ...base, metric: "js",              value: d.js },
    { ...base, metric: "centroid_cosine", value: d.centroid_cosine },
  ];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runOrg(admin: any, orgId: string): Promise<{ metrics: number; clusters: number }> {
  const now      = Date.now();
  const curStart = new Date(now - CURRENT_DAYS * 86_400_000).toISOString();
  const curEnd   = new Date(now).toISOString();
  const baseStart = new Date(now - (CURRENT_DAYS + BASELINE_DAYS) * 86_400_000).toISOString();
  const baseEnd   = curStart;

  const [current, baseline] = await Promise.all([
    pullWindow(admin, orgId, curStart, curEnd),
    pullWindow(admin, orgId, baseStart, baseEnd),
  ]);
  if (current.length < MIN_SAMPLES || baseline.length < MIN_SAMPLES) return { metrics: 0, clusters: 0 };

  const win = { start: curStart, end: curEnd };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = [];

  // Overall drift.
  rows.push(...driftRows(orgId, "all", null, computeEmbeddingDrift(baseline.map(r => r.vec), current.map(r => r.vec)), win));

  // Per-model drift for the busiest models present in both windows.
  const curByModel = new Map<string, Vec[]>();
  const baseByModel = new Map<string, Vec[]>();
  for (const r of current)  { if (!curByModel.has(r.model))  curByModel.set(r.model, []);  curByModel.get(r.model)!.push(r.vec); }
  for (const r of baseline) { if (!baseByModel.has(r.model)) baseByModel.set(r.model, []); baseByModel.get(r.model)!.push(r.vec); }
  const topModels = Array.from(curByModel.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, TOP_MODELS)
    .map(([m]) => m);
  for (const m of topModels) {
    const c = curByModel.get(m) ?? [];
    const b = baseByModel.get(m) ?? [];
    if (c.length >= MIN_SAMPLES && b.length >= MIN_SAMPLES) {
      rows.push(...driftRows(orgId, "model", m, computeEmbeddingDrift(b, c), win));
    }
  }

  if (rows.length > 0) await admin.from("drift_metrics").insert(rows);

  // ── Topic clustering over the current window ──────────────────────────────
  const sample = current.slice(0, CLUSTER_CAP);
  const vecs   = sample.map(r => r.vec);
  const k      = Math.max(1, Math.min(CLUSTER_K, Math.floor(vecs.length / 10)));
  let clustersWritten = 0;
  if (k >= 2) {
    const { assignments, centroids, sizes } = kMeans(vecs, k);

    // Snippets for labels: fetch the request_logs prompt for the sampled events.
    const eventIds = sample.map(r => r.event_id);
    const { data: logs } = await admin
      .from("request_logs").select("event_id, prompt").eq("org_id", orgId).in("event_id", eventIds);
    const snippetByEvent = new Map<string, string>();
    for (const l of (logs ?? []) as { event_id: string; prompt: unknown }[]) {
      snippetByEvent.set(l.event_id, snippet(l.prompt));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clusterRows: any[] = [];
    for (let c = 0; c < centroids.length; c++) {
      const idxs = assignments.map((a, i) => (a === c ? i : -1)).filter(i => i >= 0);
      if (idxs.length === 0) continue;
      const repIdx   = nearestToCentroid(vecs, idxs, centroids[c]);
      const repLabel = snippetByEvent.get(sample[repIdx]?.event_id) || `Cluster ${c + 1}`;
      const keywords = idxs.slice(0, 5).map(i => snippetByEvent.get(sample[i].event_id)).filter(Boolean);
      clusterRows.push({
        org_id: orgId, window_start: curStart, window_end: curEnd,
        label: repLabel.slice(0, 200), size: sizes[c], keywords,
      });
    }
    if (clusterRows.length > 0) {
      // Replace this org's clusters for the window (idempotent per cron run).
      await admin.from("clusters").delete().eq("org_id", orgId).gte("window_start", curStart);
      await admin.from("clusters").insert(clusterRows);
      clustersWritten = clusterRows.length;
    }
  }

  return { metrics: rows.length, clusters: clustersWritten };
}

function snippet(prompt: unknown): string {
  if (typeof prompt === "string") return prompt.slice(0, 200);
  if (Array.isArray(prompt)) {
    for (let k = prompt.length - 1; k >= 0; k--) {
      const m = prompt[k] as { role?: string; content?: unknown };
      if (m?.role === "user" && typeof m.content === "string") return m.content.slice(0, 200);
    }
  }
  return "";
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgs } = await (admin as any).from("organizations").select("id");

  let metrics = 0, clusters = 0;
  const errors: string[] = [];
  for (const o of (orgs ?? []) as { id: string }[]) {
    try {
      const r = await runOrg(admin, o.id);
      metrics += r.metrics; clusters += r.clusters;
    } catch (e) {
      errors.push(`${o.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return NextResponse.json({ ok: true, orgs: (orgs ?? []).length, metrics, clusters, errors: errors.length ? errors : undefined });
}
