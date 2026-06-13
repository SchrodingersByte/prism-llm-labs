/**
 * GET /api/metrics/stream
 *
 * Server-Sent Events endpoint for real-time dashboard updates.
 * Pushes 4 event types every 5 seconds:
 *   - overview_kpis   : current-window spend, requests, error rate
 *   - budget_status   : spend_usd, utilization_pct, budget_status
 *   - velocity        : cost_per_min (current 5-minute window)
 *   - active_alerts   : count of alerts fired in last 15 minutes
 *
 * Vercel constraint: streaming functions have a max duration of 60 seconds.
 * The EventSource API auto-reconnects, so the client re-establishes every ~55s.
 */
import { NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { getSpend, getWindowSpend } from "@/lib/upstash/redis";
import { resolveOrgBudget } from "@/lib/gateway/budget";
import { queryTinybird } from "@/lib/tinybird/client";

export const runtime    = "nodejs";
export const dynamic    = "force-dynamic";
export const maxDuration = 55;  // Vercel allows up to 60s; use 55 to be safe

function now19() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}
function minAgo(n: number) {
  const d = new Date(Date.now() - n * 60_000);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

async function fetchLiveMetrics(orgId: string) {
  const admin = createAdminClient();

  // Parallel fetch: Redis spend + Tinybird 5-min window + budget config
  const [redisSpend, velocityData, budgetConfig, alertCount] = await Promise.all([
    getSpend(orgId, "default").catch(() => 0),

    // 5-minute spend velocity via existing Tinybird pipe
    queryTinybird("spend_velocity_5min", {
      org_id:           orgId,
      lookback_minutes: "10",
    }).catch(() => []),

    resolveOrgBudget(admin, orgId, "").catch(() => ({ limitUsd: null, enforceHard: false })),

    // Count of recently fired alerts (last 15 min)
    (admin as any)                                                          // eslint-disable-line @typescript-eslint/no-explicit-any
      .from("alert_rules")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("is_active", true)
      .gte("last_fired_at", minAgo(15))
      .then((r: { count: number | null }) => r.count ?? 0)
      .catch(() => 0),
  ]);

  const velocityRows = velocityData as Array<{ window_cost_usd?: number; window_start: string }>;
  const latestWindow = velocityRows[0];
  const prevWindow   = velocityRows[1];

  const costPerMin  = latestWindow ? (latestWindow.window_cost_usd ?? 0) / 5 : 0;
  const spikeMult   = prevWindow && (prevWindow.window_cost_usd ?? 0) > 0
    ? (latestWindow?.window_cost_usd ?? 0) / (prevWindow.window_cost_usd ?? 1)
    : 1;

  const { limitUsd, enforceHard } = budgetConfig;
  const utilizationPct = limitUsd && limitUsd > 0 ? (redisSpend / limitUsd) * 100 : null;
  const budgetStatusVal: "on_track" | "at_risk" | "over_budget" =
    utilizationPct !== null && utilizationPct >= 100 ? "over_budget"
    : limitUsd && redisSpend > limitUsd * 0.9 ? "at_risk"
    : "on_track";

  return {
    overview_kpis: {
      spend_usd:   redisSpend,
      ts:          now19(),
    },
    budget_status: {
      spend_usd:       redisSpend,
      limit_usd:       limitUsd,
      utilization_pct: utilizationPct,
      budget_status:   budgetStatusVal,
      enforce_hard:    enforceHard,
    },
    velocity: {
      cost_per_min:   costPerMin,
      spike_multiple: spikeMult,
      window_start:   latestWindow?.window_start ?? "",
    },
    active_alerts: {
      count: alertCount as number,
    },
  };
}

export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const member = await getMemberOrg(user.id);
  if (!member) {
    return NextResponse.json({ error: "No org" }, { status: 403 });
  }
  // Org-wide live metrics stream → owner/admin only.
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orgId   = member.org_id;
  const encoder = new TextEncoder();
  let   closed  = false;

  const body = new ReadableStream({
    async start(controller) {
      function send(event: string, data: object) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(
            `event: ${event}\ndata: ${JSON.stringify(data)}\nid: ${Date.now()}\n\n`,
          ));
        } catch { closed = true; }
      }

      async function pushAll() {
        try {
          const metrics = await fetchLiveMetrics(orgId);
          send("overview_kpis",  metrics.overview_kpis);
          send("budget_status",  metrics.budget_status);
          send("velocity",       metrics.velocity);
          send("active_alerts",  metrics.active_alerts);
        } catch { /* don't crash the stream on metric fetch error */ }
      }

      // Send initial snapshot immediately
      await pushAll();

      // Push updates every 5 seconds
      const timer = setInterval(() => { void pushAll(); }, 5_000);

      // Cleanup when stream is cancelled (client disconnects)
      return () => { closed = true; clearInterval(timer); };
    },
    cancel() { closed = true; },
  });

  return new Response(body, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache, no-transform",
      "Connection":        "keep-alive",
      "X-Accel-Buffering": "no",   // disable nginx/proxy buffering
    },
  });
}
