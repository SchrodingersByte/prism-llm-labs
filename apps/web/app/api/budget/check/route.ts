import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { getSpend } from "@/lib/upstash/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


interface KeyRow       { org_id: string; project_id: string | null }
interface ProjectRow   { id: string; monthly_budget_usd: number | null }
interface BudgetRow    { amount_usd: number; enforce_hard_cap: boolean }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveBudget(
  supabaseAdmin: any,
  orgId: string,
  projectId: string,
): Promise<{ limitUsd: number | null; enforceHard: boolean }> {
  // ── Try project-level budget (projectId is a UUID from the key record) ────
  if (projectId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proj } = await (supabaseAdmin as any)
      .from("projects")
      .select("id, monthly_budget_usd")
      .eq("id", projectId)
      .eq("org_id", orgId)
      .maybeSingle() as { data: ProjectRow | null };

    if (proj) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row } = await (supabaseAdmin as any)
        .from("budgets")
        .select("amount_usd, enforce_hard_cap")
        .eq("org_id", orgId)
        .eq("project_id", proj.id)
        .eq("period", "monthly")
        .limit(1)
        .maybeSingle() as { data: BudgetRow | null };

      if (row) return { limitUsd: row.amount_usd, enforceHard: row.enforce_hard_cap };
      if (proj.monthly_budget_usd != null) {
        return { limitUsd: proj.monthly_budget_usd, enforceHard: false };
      }
    }
  }

  // ── Org-level fallback ─────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgBudget } = await (supabaseAdmin as any)
    .from("budgets")
    .select("amount_usd, enforce_hard_cap")
    .eq("org_id", orgId)
    .is("project_id", null)
    .is("user_id", null)
    .eq("period", "monthly")
    .limit(1)
    .maybeSingle() as { data: BudgetRow | null };

  if (orgBudget) return { limitUsd: orgBudget.amount_usd, enforceHard: orgBudget.enforce_hard_cap };

  return { limitUsd: null, enforceHard: false };
}

export async function GET(req: NextRequest) {
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // ── Authenticate via Prism API key prefix ─────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const apiKey     = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 401 });
  }

  // Verify the full key against its stored SHA-256 hash — prefix alone is not sufficient
  const keyHash = createHash("sha256").update(apiKey).digest("hex");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: keyRow } = await (supabaseAdmin as any)
    .from("api_keys")
    .select("org_id, project_id, is_active")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle() as { data: KeyRow | null };

  if (!keyRow) {
    return NextResponse.json({ error: "Invalid or inactive API key" }, { status: 401 });
  }

  const orgId     = keyRow.org_id;
  // Project is resolved from the key record — the SDK no longer sends it
  const projectId = keyRow.project_id ?? "";

  // ── Read current spend from Redis ─────────────────────────────────────────
  const redisProjectId = projectId || "default";
  const spend          = await getSpend(orgId, redisProjectId).catch(() => 0);

  // ── Resolve configured budget limit ───────────────────────────────────────
  // Pass projectId (UUID) directly — skip the name/slug resolution path
  const { limitUsd, enforceHard } = await resolveBudget(supabaseAdmin, orgId, projectId);

  // ── Decision ──────────────────────────────────────────────────────────────
  const pct     = limitUsd != null && limitUsd > 0 ? (spend / limitUsd) * 100 : 0;
  const allowed = limitUsd == null || !enforceHard || spend < limitUsd;

  return NextResponse.json(
    {
      allowed,
      spend,
      limit:   limitUsd,
      pct:     Math.round(pct * 100) / 100,
      enforce: enforceHard,
    },
    // 5-second client-side cache — SDKs cache this locally so the pre-call
    // check adds at most one network round-trip per 5-second window, not per call.
    { headers: { "Cache-Control": "public, max-age=5" } },
  );
}
