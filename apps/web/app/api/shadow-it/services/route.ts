/**
 * GET /api/shadow-it/services
 *
 * Returns all instrumented services (enforce_checkins) for the org,
 * enriched with a Gateway Coverage Score derived from the reconciliation
 * delta (prism-tracked requests / provider-billed requests * 100).
 */

import { NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: checkins } = await (admin as any)
    .from("enforce_checkins")
    .select("id, service_name, app_version, enforce_mode, language, first_seen_at, last_seen_at, bypass_count")
    .eq("org_id", member.org_id)
    .order("last_seen_at", { ascending: false });

  // Coverage score: total gateway events / total bypass events (as a rough proxy).
  // A more accurate version would use reconciliation data, but this gives a useful
  // directional signal without requiring the billing sync to be configured.
  //
  // Count Prism-tracked requests in the last 30 days from Tinybird via the
  // overview_metrics pipe. Fall back gracefully if Tinybird is unavailable.
  let coverageScore: number | null = null;
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000)
      .toISOString().replace("T", " ").slice(0, 19);
    const today = new Date().toISOString().replace("T", " ").slice(0, 19);
    const tbUrl = `${process.env.TINYBIRD_API_URL}/v0/pipes/overview_metrics.json` +
                  `?org_id=${member.org_id}&from_date=${thirtyDaysAgo}&to_date=${today}`;
    const tbRes = await fetch(tbUrl, {
      headers: { Authorization: `Bearer ${process.env.TINYBIRD_ADMIN_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
    if (tbRes.ok) {
      const tbJson = await tbRes.json() as { data: Array<{ total_requests?: number }> };
      const prismRequests = tbJson.data?.[0]?.total_requests ?? 0;
      const totalBypasses = (checkins ?? []).reduce(
        (sum: number, c: { bypass_count?: number }) => sum + (c.bypass_count ?? 0), 0,
      );
      const total = prismRequests + totalBypasses;
      coverageScore = total > 0 ? Math.round((prismRequests / total) * 100) : 100;
    }
  } catch { /* Tinybird unavailable — skip coverage score */ }

  return NextResponse.json({
    services:       checkins ?? [],
    coverage_score: coverageScore,
    total_services: (checkins ?? []).length,
    total_bypasses: (checkins ?? []).reduce(
      (sum: number, c: { bypass_count?: number }) => sum + (c.bypass_count ?? 0), 0,
    ),
  });
}
