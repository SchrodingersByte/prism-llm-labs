/**
 * POST /api/mcp/reconcile
 *
 * Accepts actual billing data for an MCP tool event that was previously recorded
 * with an estimated cost. Stores the reconciliation in Supabase so the sessions
 * dashboard can show "Actual: $X" alongside the original estimate.
 *
 * Auth: same Prism API key used for /api/mcp/ingest
 *
 * Use cases:
 *   - AWS Cost Explorer: daily actual Lambda / DynamoDB costs become available
 *   - Pinecone usage API: monthly actual read/write units
 *   - Manual correction after auditing a provider bill
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authenticateIngestKey } from "@/lib/ingest/auth";
import { z } from "zod";

const BodySchema = z.object({
  event_id:        z.string().min(1),
  session_id:      z.string().default(""),
  actual_cost_usd: z.number().nonnegative(),
  estimated_cost_usd: z.number().nonnegative().default(0),
  cost_source:     z.string().default("manual"),
});

export async function POST(req: NextRequest) {
  // Reuse the same key auth as /api/mcp/ingest
  const auth = await authenticateIngestKey(req.headers.get("authorization") ?? "");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { key } = auth;

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  const { event_id, session_id, actual_cost_usd, estimated_cost_usd, cost_source } = parsed.data;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { error: dbErr } = await supabase
    .from("mcp_cost_reconciliation")
    .upsert({
      org_id:         key.org_id,
      event_id,
      session_id,
      estimated_cost: estimated_cost_usd,
      actual_cost:    actual_cost_usd,
      cost_source,
      reconciled_at:  new Date().toISOString(),
    }, { onConflict: "org_id,event_id" });

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  const delta = actual_cost_usd - estimated_cost_usd;
  return NextResponse.json({
    ok:        true,
    delta_usd: Math.round(delta * 1e9) / 1e9,   // round to nanocents
    message:   delta > 0
      ? `Actual cost was $${delta.toFixed(6)} higher than estimate`
      : delta < 0
        ? `Actual cost was $${Math.abs(delta).toFixed(6)} lower than estimate`
        : "Actual cost matches estimate",
  });
}
