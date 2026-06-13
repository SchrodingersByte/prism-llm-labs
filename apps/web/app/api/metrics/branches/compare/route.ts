/**
 * GET /api/metrics/branches/compare
 *
 * Compare LLM spend between two git branches over a time window.
 * Used by the GitHub Action PR cost bot to post a cost-diff comment on PRs.
 *
 * Query params:
 *   branch     - head branch name (required)
 *   base       - base branch name (default: "main")
 *   days       - lookback window in days (default: 30)
 *   project_id - optional project UUID filter
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { getSpendByBranchName, type BranchSpend } from "@/lib/tinybird/queries";
import { z } from "zod";

const QuerySchema = z.object({
  branch:     z.string().min(1),
  base:       z.string().default("main"),
  days:       z.coerce.number().int().min(1).max(90).default(30),
  project_id: z.string().uuid().optional(),
});

function dateRange(days: number): { from: string; to: string } {
  const to   = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const fmt  = (d: Date) => d.toISOString().slice(0, 10) + " 00:00:00";
  return { from: fmt(from), to: fmt(to) };
}

const ZERO_BRANCH = (name: string): BranchSpend => ({
  branch:         name,
  commit_sha:     "",
  cost_usd:       0,
  requests:       0,
  total_tokens:   0,
  avg_latency_ms: 0,
});

export async function GET(req: NextRequest) {
  // Accept either session auth (dashboard) or Prism API key (GitHub Action)
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerKey  = authHeader.replace(/^Bearer\s+/i, "").trim();

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let orgId: string | null = null;

  if (bearerKey) {
    // API-key auth path (used by the GitHub Action)
    const keyHash = createHash("sha256").update(bearerKey).digest("hex");
    const { data: keyRow } = await supabaseAdmin
      .from("api_keys")
      .select("org_id, is_active, expires_at")
      .eq("key_hash", keyHash)
      .eq("is_active", true)
      .maybeSingle();

    if (!keyRow) {
      return NextResponse.json({ error: "Invalid or inactive API key" }, { status: 401 });
    }
    if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
      return NextResponse.json({ error: "API key has expired" }, { status: 401 });
    }
    orgId = keyRow.org_id as string;
  } else {
    // Session auth path (used by the dashboard)
    const { requireAuth } = await import("@/lib/supabase/auth");
    const ctx = await requireAuth();
    if (ctx instanceof NextResponse) return ctx;
    orgId = ctx.orgId;
  }

  const params = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) {
    return NextResponse.json({ error: "Invalid params: " + params.error.issues[0]?.message }, { status: 400 });
  }

  const { branch, base, days, project_id } = params.data;
  const { from, to } = dateRange(days);

  try {
    const [head, baseData] = await Promise.all([
      getSpendByBranchName(orgId!, branch, from, to, project_id),
      getSpendByBranchName(orgId!, base,   from, to, project_id),
    ]);

    const headData = head ?? ZERO_BRANCH(branch);
    const baseRow  = baseData ?? ZERO_BRANCH(base);

    const delta = {
      cost_usd:       headData.cost_usd       - baseRow.cost_usd,
      requests:       headData.requests        - baseRow.requests,
      total_tokens:   headData.total_tokens    - baseRow.total_tokens,
      avg_latency_ms: headData.avg_latency_ms  - baseRow.avg_latency_ms,
      cost_pct_change: baseRow.cost_usd > 0
        ? ((headData.cost_usd - baseRow.cost_usd) / baseRow.cost_usd) * 100
        : null,
    };

    return NextResponse.json({
      period: { from, to, days },
      head:   headData,
      base:   baseRow,
      delta,
    });
  } catch (e) {
    console.error("[branches/compare] error:", e);
    return NextResponse.json({ error: "Failed to fetch branch comparison" }, { status: 500 });
  }
}
