import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { checkFeature } from "@/lib/billing/feature-guard";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  // Requires pii_incident_log feature (Enterprise+ by default)
  const featureGuard = await checkFeature(ctx.orgId, "pii_incident_log");
  if (featureGuard) return featureGuard;

  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to   = searchParams.get("to");

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("pii_incidents" as any)
    .select(`
      created_at,
      provider,
      model,
      pii_types,
      action_taken,
      user_id,
      api_keys (name)
    `)
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(10_000);

  if (from) query = query.gte("created_at", from);
  if (to)   query = query.lte("created_at", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Query failed" }, { status: 500 });

  const rows = (data ?? []) as Array<{
    created_at:  string;
    provider:    string;
    model:       string;
    pii_types:   string[];
    action_taken:string;
    user_id:     string | null;
    api_keys:    { name: string } | null;
  }>;

  const lines = [
    "timestamp,api_key_name,provider,model,pii_types,action_taken,user_id",
    ...rows.map(r => [
      r.created_at,
      `"${(r.api_keys?.name ?? "").replace(/"/g, '""')}"`,
      r.provider,
      r.model,
      `"${r.pii_types.join(", ")}"`,
      r.action_taken,
      r.user_id ?? "",
    ].join(",")),
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type":        "text/csv",
      "Content-Disposition": `attachment; filename="pii-incidents-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
