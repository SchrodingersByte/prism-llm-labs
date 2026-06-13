/**
 * GET /api/metrics/account-overview?account_id=...&from=...&to=...
 *
 * Returns consolidated spend metrics across all orgs in an account.
 * Access restricted to account_members with role "owner" or "admin".
 *
 * Implementation: fan-out parallel Tinybird queries per org, aggregate at the API layer.
 * Tinybird pipes remain org-scoped for security isolation.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { getOverviewMetrics } from "@/lib/tinybird/queries";
import { z } from "zod";

function thirtyDaysAgo() {
  const d = new Date(); d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10) + " 00:00:00";
}
function today() { return new Date().toISOString().slice(0, 10) + " 23:59:59"; }

const QuerySchema = z.object({
  account_id: z.string().uuid(),
  from:       z.string().default(thirtyDaysAgo),
  to:         z.string().default(today),
});

export interface OrgSpendSummary {
  org_id:         string;
  org_name:       string;
  total_cost_usd: number;
  requests:       number;
  tokens:         number;
  error_rate:     number;
  pct_of_total:   number;
}

export interface AccountOverviewResponse {
  account:  { id: string; name: string };
  totals:   { total_cost_usd: number; requests: number; tokens: number; error_rate: number; org_count: number };
  by_org:   OrgSpendSummary[];
  period:   { from: string; to: string };
}

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) {
    return NextResponse.json({ error: params.error.issues[0]?.message ?? "Invalid params" }, { status: 400 });
  }

  const { account_id, from, to } = params.data;
  const admin = createAdminClient();

  // Verify user is an account member (owner or admin)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (admin as any)
    .from("account_members")
    .select("role, accounts(id, name)")
    .eq("account_id", account_id)
    .eq("user_id", user.id)
    .maybeSingle() as {
      data: { role: string; accounts: { id: string; name: string } | null } | null;
    };

  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const account = membership.accounts ?? { id: account_id, name: "Account" };

  // Load all orgs linked to this account — constrained by FK, no IDOR possible
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgs } = await (admin as any)
    .from("organizations")
    .select("id, name")
    .eq("account_id", account_id) as { data: Array<{ id: string; name: string }> | null };

  if (!orgs?.length) {
    return NextResponse.json({
      account,
      totals:  { total_cost_usd: 0, requests: 0, tokens: 0, error_rate: 0, org_count: 0 },
      by_org:  [],
      period:  { from, to },
    });
  }

  // Fan out parallel Tinybird queries — one per org
  const orgMetrics = await Promise.all(
    orgs.map(async org => {
      const metrics = await getOverviewMetrics(org.id, from, to).catch(() => null);
      return { org, metrics };
    }),
  );

  // Aggregate
  let totalCost  = 0, totalReqs = 0, totalTokens = 0, totalErrors = 0;
  for (const { metrics } of orgMetrics) {
    if (!metrics) continue;
    totalCost   += metrics.total_cost_usd ?? 0;
    totalReqs   += metrics.total_requests ?? 0;
    totalTokens += (metrics.total_input_tokens ?? 0) + (metrics.total_output_tokens ?? 0);
    totalErrors += (metrics.error_count ?? 0);
  }

  const byOrg: OrgSpendSummary[] = orgMetrics.map(({ org, metrics }) => {
    const cost     = metrics?.total_cost_usd ?? 0;
    const requests = metrics?.total_requests ?? 0;
    const tokens   = (metrics?.total_input_tokens ?? 0) + (metrics?.total_output_tokens ?? 0);
    return {
      org_id:         org.id,
      org_name:       org.name,
      total_cost_usd: cost,
      requests,
      tokens,
      error_rate:     requests > 0 ? (metrics?.error_count ?? 0) / requests : 0,
      pct_of_total:   totalCost > 0 ? (cost / totalCost) * 100 : 0,
    };
  }).sort((a, b) => b.total_cost_usd - a.total_cost_usd);

  const response: AccountOverviewResponse = {
    account,
    totals: {
      total_cost_usd: totalCost,
      requests:       totalReqs,
      tokens:         totalTokens,
      error_rate:     totalReqs > 0 ? totalErrors / totalReqs : 0,
      org_count:      orgs.length,
    },
    by_org:  byOrg,
    period:  { from, to },
  };

  return NextResponse.json(response);
}
