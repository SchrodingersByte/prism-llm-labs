/**
 * GET /api/billing/sync
 *
 * Triggered by Vercel Cron daily at 01:00 UTC.
 * Also callable manually by org admins via the settings UI.
 *
 * Auth:
 *   - Vercel Cron: Authorization: Bearer ${CRON_SECRET}
 *   - Manual (dashboard): session cookie (Supabase auth)
 *
 * Cron: runs synchronously (300s budget is fine for daily background work).
 * Dashboard: returns 202 immediately; sync continues via unstable_after.
 * Job status is tracked in Redis: billing:sync:job:{jobId}
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { syncAllConnections } from "@/lib/billing/sync";
import { redis } from "@/lib/upstash/redis";
import { v4 as uuidv4 } from "uuid";
// unstable_after is experimental in Next.js 14.2 — wrap import to fail gracefully
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let unstable_after: ((fn: () => Promise<unknown>) => void) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  unstable_after = require("next/server").unstable_after ?? null;
} catch { /* not available in this Next.js version */ }

export const runtime = "nodejs";
export const maxDuration = 300; // billing sync can take a while for large orgs

interface JobState {
  status:         "running" | "done" | "error";
  started_at:     string;
  finished_at?:   string;
  synced?:        number;
  errors?:        Array<{ provider: string; org_id: string; error: string | undefined }>;
  total_cost_usd?: number;
  error?:         string;
}

async function doSync(jobId: string, orgId: string | undefined): Promise<void> {
  const key = `billing:sync:job:${jobId}`;
  try {
    const results      = await syncAllConnections(orgId);
    const synced       = results.filter((r) => !r.error).length;
    const errors       = results.filter((r) => r.error).map((r) => ({
      provider: r.provider,
      org_id:   r.org_id,
      error:    r.error,
    }));
    const total_cost_usd = results.reduce((s, r) => s + r.total_cost_usd, 0);
    const state: JobState = {
      status:        "done",
      started_at:    (await redis.get<string>(`${key}:started_at`) ?? new Date().toISOString()),
      finished_at:   new Date().toISOString(),
      synced,
      errors,
      total_cost_usd,
    };
    await redis.set(key, JSON.stringify(state), { ex: 86_400 });
  } catch (err) {
    const state: JobState = {
      status:      "error",
      started_at:  (await redis.get<string>(`${key}:started_at`) ?? new Date().toISOString()),
      finished_at: new Date().toISOString(),
      error:       err instanceof Error ? err.message : "sync failed",
    };
    await redis.set(key, JSON.stringify(state), { ex: 86_400 });
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;

  let orgId: string | undefined;
  let isCron = false;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    orgId  = undefined;
    isCron = true;
  } else {
    const supabase = createServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const member = await getMemberOrg(user.id);
    if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
    orgId = member.org_id;
  }

  // Cron path: run synchronously within the 300s budget
  if (isCron || !unstable_after) {
    try {
      const results      = await syncAllConnections(orgId);
      const synced       = results.filter((r) => !r.error).length;
      const errors       = results.filter((r) => r.error).map((r) => ({
        provider: r.provider,
        org_id:   r.org_id,
        error:    r.error,
      }));
      const totalCost = results.reduce((s, r) => s + r.total_cost_usd, 0);

      return NextResponse.json({
        ok:          true,
        synced,
        errors,
        total_cost_usd: totalCost,
        connections: results.length,
      });
    } catch (err) {
      console.error("[billing/sync] Fatal error:", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "sync failed" },
        { status: 500 },
      );
    }
  }

  // Dashboard path: return 202 immediately, run sync in background
  const jobId      = uuidv4();
  const startedAt  = new Date().toISOString();
  const jobKey     = `billing:sync:job:${jobId}`;
  const initialState: JobState = { status: "running", started_at: startedAt };

  await redis.set(jobKey, JSON.stringify(initialState), { ex: 86_400 });
  await redis.set(`${jobKey}:started_at`, startedAt, { ex: 86_400 });

  unstable_after(() => doSync(jobId, orgId));

  return NextResponse.json(
    { ok: true, job_id: jobId, status: "running" },
    { status: 202 },
  );
}
