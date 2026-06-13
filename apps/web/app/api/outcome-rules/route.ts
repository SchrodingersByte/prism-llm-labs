import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const VALID_SOURCES = [
  "github_pr_merge",
  "github_deployment_success",
  "stripe_payment",
  "generic_webhook",
  "mcp_session_success",
] as const;

const CreateSchema = z.object({
  event_source: z.enum(VALID_SOURCES),
  feature_tag:  z.string().min(1).max(100),
  action_tag:   z.string().max(100).optional(),
  value_usd:    z.number().nonnegative().optional(),
  success:      z.boolean().default(true),
});

export async function GET() {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("outcome_rules")
    .select("id, event_source, feature_tag, action_tag, value_usd, success, is_active, created_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("outcome_rules")
    .insert({
      org_id:       ctx.orgId,
      event_source: parsed.data.event_source,
      feature_tag:  parsed.data.feature_tag,
      action_tag:   parsed.data.action_tag  ?? null,
      value_usd:    parsed.data.value_usd   ?? null,
      success:      parsed.data.success,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
