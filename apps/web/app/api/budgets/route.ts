import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const CreateBudgetSchema = z.object({
  project_id:       z.string().uuid().optional(),
  user_id:          z.string().uuid().optional(),
  provider:         z.string().optional(),            // provider-level budget, e.g. "openai"
  period:           z.enum(["monthly", "daily"]).default("monthly"),
  amount_usd:       z.number().positive(),
  alert_pct:        z.number().int().min(1).max(100).default(80),
  enforce_hard_cap: z.boolean().default(false),
});

export async function GET() {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  const isPrivileged = ctx.canManage;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("budgets")
    .select("*")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false });

  // Non-privileged roles only see org-wide budgets (no user_id) or their own.
  if (!isPrivileged) {
    query = query.or(`user_id.is.null,user_id.eq.${ctx.user.id}`);
  }

  const { data: budgets, error: dbErr } = await query;
  if (dbErr) return NextResponse.json({ error: "DB error" }, { status: 500 });

  return NextResponse.json({ data: budgets });
}

export async function POST(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateBudgetSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json({ error: first ? `${first.path.join(".")}: ${first.message}` : "Invalid request" }, { status: 400 });
  }

  const { project_id, user_id, provider, period, amount_usd, alert_pct, enforce_hard_cap } = parsed.data;
  const admin = createAdminClient();
  const isPrivileged = ctx.canManage;

  // Only owners/admins set org / project / provider / other-user budgets.
  // A developer may only set a budget on themselves.
  const isSelfUserBudget = !!user_id && user_id === ctx.user.id && !project_id && !provider;
  if (!isPrivileged && !isSelfUserBudget) {
    return NextResponse.json(
      { error: "Only owners and admins can set org, project, or provider budgets" },
      { status: 403 },
    );
  }

  // Validate referenced entities belong to the org.
  if (user_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: targetMember } = await (admin as any)
      .from("members").select("id").eq("org_id", ctx.orgId).eq("user_id", user_id).maybeSingle();
    if (!targetMember) return NextResponse.json({ error: "User not found in org" }, { status: 404 });
  }
  if (project_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proj } = await (admin as any)
      .from("projects").select("id").eq("org_id", ctx.orgId).eq("id", project_id).maybeSingle();
    if (!proj) return NextResponse.json({ error: "Project not found in org" }, { status: 404 });
  }

  // Budget hierarchy: a project budget cannot exceed the org-wide budget for the
  // same period (when an org-wide budget exists).
  if (project_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orgBudget } = await (admin as any)
      .from("budgets")
      .select("amount_usd")
      .eq("org_id", ctx.orgId)
      .is("project_id", null)
      .is("user_id", null)
      .is("provider", null)
      .eq("period", period)
      .maybeSingle() as { data: { amount_usd: number } | null };

    if (orgBudget && amount_usd > orgBudget.amount_usd) {
      return NextResponse.json(
        {
          error:   "budget_exceeds_org",
          message: `Project budget ($${amount_usd}) cannot exceed the org ${period} budget ($${orgBudget.amount_usd}).`,
        },
        { status: 400 },
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error: dbErr } = await (admin as any)
    .from("budgets")
    .insert({
      org_id:              ctx.orgId,
      project_id:          project_id ?? null,
      user_id:             user_id    ?? null,
      provider:            provider   ?? null,
      period,
      amount_usd,
      alert_threshold_pct: alert_pct,
      enforce_hard_cap,
    })
    .select("*")
    .single();

  if (dbErr) {
    // 23505 = unique violation on budgets_scope_uniq (a budget for this scope exists).
    if (dbErr.code === "23505") {
      return NextResponse.json({ error: "A budget already exists for this scope" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create budget", detail: dbErr.message }, { status: 500 });
  }

  return NextResponse.json({ data: inserted }, { status: 201 });
}
