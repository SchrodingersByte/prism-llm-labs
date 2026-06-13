/**
 * GET /api/metrics/customers
 *
 * Returns current-month spend for all customers, joined with quota profiles.
 * Used by the dashboard Customers tab table. Auth: session cookie.
 *
 * Query params:
 *   from   datetime string
 *   to     datetime string
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";
import { getSpendByCustomer } from "@/lib/tinybird/queries";

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const sp   = req.nextUrl.searchParams;
  const from = sp.get("from") ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10) + " 00:00:00";
  const to   = sp.get("to")   ?? new Date().toISOString().slice(0, 10) + " 23:59:59";

  const [spendRows, quotaRes] = await Promise.all([
    getSpendByCustomer(member.org_id, from, to),
    (createAdminClient() as unknown as { from: (t: string) => { select: (s: string) => { eq: (k: string, v: string) => { order: (k: string, o: object) => Promise<{ data: unknown[] | null }> } } } })
      .from("customer_quota_profiles" as any)
      .select("id, customer_id, display_name, monthly_spend_usd, monthly_token_limit, soft_cap_pct, soft_cap_model, is_active, created_at")
      .eq("org_id", member.org_id)
      .order("created_at", { ascending: false }),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const profiles = ((quotaRes as any).data ?? []) as Array<{
    id:                  string;
    customer_id:         string;
    display_name:        string | null;
    monthly_spend_usd:   number | null;
    monthly_token_limit: number | null;
    soft_cap_pct:        number;
    soft_cap_model:      string | null;
    is_active:           boolean;
    created_at:          string;
  }>;

  // Build a spend map for O(1) lookup
  const spendMap = new Map(spendRows.map(r => [r.customer_id, r]));

  // Merge: every profile gets current spend injected; customers with spend but
  // no profile are appended at the end as "unregistered" (no quota set).
  const merged = profiles.map(p => {
    const spend = spendMap.get(p.customer_id);
    const costUsd = spend?.total_cost_usd ?? 0;
    const limitUsd = p.monthly_spend_usd;
    return {
      id:                  p.id,
      customer_id:         p.customer_id,
      display_name:        p.display_name,
      monthly_spend_usd:   limitUsd,
      monthly_token_limit: p.monthly_token_limit,
      soft_cap_pct:        p.soft_cap_pct,
      soft_cap_model:      p.soft_cap_model,
      is_active:           p.is_active,
      created_at:          p.created_at,
      // Live spend
      current_cost_usd:    costUsd,
      current_tokens:      spend?.total_tokens ?? 0,
      requests:            spend?.requests     ?? 0,
      // Derived
      utilization_pct:     limitUsd && limitUsd > 0 ? Math.round((costUsd / limitUsd) * 1000) / 10 : null,
      status: !limitUsd
        ? "unlimited"
        : costUsd >= limitUsd      ? "over_budget"
        : costUsd >= limitUsd * 0.8 ? "at_risk"
        : "on_track",
    };
  });

  // Append unregistered customers (seen in Tinybird but no profile row)
  const knownIds = new Set(profiles.map(p => p.customer_id));
  for (const spend of spendRows) {
    if (!knownIds.has(spend.customer_id)) {
      merged.push({
        id:                  "",
        customer_id:         spend.customer_id,
        display_name:        null,
        monthly_spend_usd:   null,
        monthly_token_limit: null,
        soft_cap_pct:        80,
        soft_cap_model:      null,
        is_active:           true,
        created_at:          "",
        current_cost_usd:    spend.total_cost_usd,
        current_tokens:      spend.total_tokens,
        requests:            spend.requests,
        utilization_pct:     null,
        status:              "unlimited",
      });
    }
  }

  return NextResponse.json({ data: merged });
}
