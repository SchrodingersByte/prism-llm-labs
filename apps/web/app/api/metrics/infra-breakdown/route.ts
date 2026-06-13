import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { getInfraCostBreakdown } from "@/lib/tinybird/queries";

function thirtyDaysAgo() {
  return new Date(Date.now() - 30 * 86_400_000).toISOString().replace("T", " ").slice(0, 19);
}
function today() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const from = req.nextUrl.searchParams.get("from") ?? thirtyDaysAgo();
  const to   = req.nextUrl.searchParams.get("to")   ?? today();

  const admin = createAdminClient();

  const [tinybirdData, gpuResult] = await Promise.all([
    getInfraCostBreakdown(member.org_id, from, to),
    // GPU inference runs come from Supabase (not Tinybird)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any)
      .from("gpu_inference_runs")
      .select("cost_usd, provider")
      .eq("org_id", member.org_id)
      .gte("created_at", from)
      .lte("created_at", to)
      .then((r: { data: unknown }) => r, () => ({ data: null })),
  ]);

  const gpuRows = (gpuResult as { data: Array<{ cost_usd: number; provider: string }> | null }).data ?? [];
  const gpuTotalByProvider = gpuRows.reduce<Record<string, number>>((acc, r) => {
    const key = `gpu_inference:${r.provider}`;
    acc[key] = (acc[key] ?? 0) + r.cost_usd;
    return acc;
  }, {});

  const gpuEntries = Object.entries(gpuTotalByProvider).map(([category, cost_usd]) => ({
    category,
    cost_usd,
    events: gpuRows.filter(r => `gpu_inference:${r.provider}` === category).length,
  }));

  return NextResponse.json({ data: [...(tinybirdData ?? []), ...gpuEntries] });
}
