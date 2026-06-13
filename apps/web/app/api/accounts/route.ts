import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

// GET /api/accounts â€” list accounts the current user belongs to
export async function GET() {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("account_members")
    .select("role, accounts(id, name, slug, plan, sso_enabled, created_at)")
    .eq("user_id", ctx.user.id) as {
      data: Array<{
        role: string;
        accounts: { id: string; name: string; slug: string; plan: string; sso_enabled: boolean; created_at: string };
      }> | null;
      error: unknown;
    };

  if (error) return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });

  const accounts = (data ?? []).map(row => ({
    ...row.accounts,
    memberRole: row.role,
  }));

  return NextResponse.json({ accounts });
}

const CreateAccountSchema = z.object({
  name: z.string().min(2).max(80),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
  plan: z.enum(["enterprise", "enterprise_plus"]).default("enterprise"),
});

// POST /api/accounts â€” create a new enterprise account (org owners only)
export async function POST(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner"] });
  if (ctx instanceof NextResponse) return ctx;

  const body = CreateAccountSchema.safeParse(await req.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  const admin = createAdminClient();

  // Check slug uniqueness
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin as any)
    .from("accounts" as any)
    .select("id")
    .eq("slug", body.data.slug)
    .maybeSingle() as { data: { id: string } | null };

  if (existing) {
    return NextResponse.json({ error: "Slug already taken" }, { status: 409 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: account, error: createErr } = await (admin as any)
    .from("accounts" as any)
    .insert({ name: body.data.name, slug: body.data.slug, plan: body.data.plan })
    .select()
    .single() as { data: { id: string } | null; error: unknown };

  if (createErr || !account) {
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }

  // Add creator as account owner
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("account_members")
    .insert({ account_id: account.id, user_id: ctx.user.id, role: "owner" });

  // Link the creator's active org to this account
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("organizations")
    .update({ account_id: account.id })
    .eq("id", ctx.orgId);

  // Audit log
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("audit_log").insert({
    org_id:        ctx.orgId,
    actor_user_id: ctx.user.id,
    action:        "account.created",
    target_type:   "account",
    target_id:     account.id,
    metadata:      { name: body.data.name, slug: body.data.slug },
  }).catch(console.error);

  return NextResponse.json({ account }, { status: 201 });
}
