/**
 * Daily cron: drive the Model Intelligence Engine for every org.
 *
 * Before this existed, buildRecommendations() ran only when someone loaded
 * GET /api/engine/recommendations — and with the dashboard UI stubbed out that
 * effectively never happened, so recommendation_actions stayed empty and no
 * model substitution was ever active (deficiency D3). This cron computes and
 * seeds recommendations on a schedule so the engine runs headless.
 *
 * Call via Vercel Cron (vercel.json) or any scheduler with
 *   Authorization: Bearer <CRON_SECRET>
 * (same guard as /api/cron/reconcile-usage).
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { computeAndPersistRecommendations } from "@/lib/engine/run";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient() as SupabaseClient<Database>;
  const { data: orgs } = await admin.from("organizations").select("id");

  if (!orgs || orgs.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, seeded: 0 });
  }

  let processed = 0;
  let seeded    = 0;
  const errors: string[] = [];

  // Per-org try/catch so one org's Tinybird/DB hiccup can't abort the batch.
  for (const org of orgs) {
    try {
      const result = await computeAndPersistRecommendations(org.id);
      seeded += result.seeded;
      processed++;
    } catch (e) {
      errors.push(`${org.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    seeded,
    errors: errors.length ? errors : undefined,
  });
}
