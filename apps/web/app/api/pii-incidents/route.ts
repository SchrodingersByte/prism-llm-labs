import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { checkFeature } from "@/lib/billing/feature-guard";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  // Requires pii_detection feature (Startup+ by default)
  const featureGuard = await checkFeature(ctx.orgId, "pii_detection");
  if (featureGuard) return featureGuard;

  const { searchParams } = req.nextUrl;
  const from    = searchParams.get("from");
  const to      = searchParams.get("to");
  const keyId   = searchParams.get("key_id");
  const piiType = searchParams.get("pii_type");

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("pii_incidents" as any)
    .select("*")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (from)    query = query.gte("created_at", from);
  if (to)      query = query.lte("created_at", to);
  if (keyId)   query = query.eq("api_key_id", keyId);
  if (piiType) query = query.contains("pii_types", [piiType]);

  const { data: incidents, error } = await query;
  if (error) return NextResponse.json({ error: "Query failed" }, { status: 500 });

  const rows = (incidents ?? []) as Array<{
    pii_types: string[];
    action_taken: string;
    model: string;
    api_key_id: string | null;
  }>;

  // Always return aggregate counts
  const by_type: Record<string, number> = {};
  const by_model: Record<string, number> = {};
  for (const row of rows) {
    for (const t of row.pii_types) by_type[t] = (by_type[t] ?? 0) + 1;
    by_model[row.model] = (by_model[row.model] ?? 0) + 1;
  }

  // Row-level detail only for orgs with pii_incident_log feature (Enterprise+ by default)
  const incidentLogGuard = await checkFeature(ctx.orgId, "pii_incident_log");
  const includeRows = !incidentLogGuard; // null = allowed

  return NextResponse.json({
    total:    rows.length,
    by_type,
    by_model,
    incidents: includeRows ? incidents : undefined,
  });
}
