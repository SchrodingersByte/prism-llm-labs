import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/supabase/auth";
import { z } from "zod";

const PolicySchema = z.object({
  name:                   z.string().min(1).max(100).default("Workspace Policy"),
  requests_per_minute:    z.number().int().positive().nullable().optional(),
  tokens_per_day:         z.number().int().positive().nullable().optional(),
  monthly_budget_usd:     z.number().positive().nullable().optional(),
  daily_budget_usd:       z.number().positive().nullable().optional(),
  soft_cap_pct:           z.number().int().min(1).max(100).nullable().optional(),
  soft_cap_fallback_model: z.string().max(120).nullable().optional(),
  gateway_required:       z.boolean().default(false),
  data_residency_region:  z.enum(["us", "eu", "apac"]).nullable().optional(),
  model_policy:           z.enum(["open", "allowlist", "blocklist", "requires_approval"]).default("open"),
  allowed_models:         z.array(z.string().min(1)).default([]),
  blocked_models:         z.array(z.string().min(1)).default([]),
  pii_detection_enabled:  z.boolean().default(false),
  pii_action:             z.enum(["mask", "block", "log_only"]).default("mask"),
});

export async function GET() {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  const { data } = await (admin as any)
    .from("enforcement_policies")
    .select("*")
    .eq("scope_type", "org")
    .eq("scope_id", ctx.orgId)
    .maybeSingle();

  return NextResponse.json({ policy: data ?? null });
}

export async function PUT(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PolicySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await (admin as any)
    .from("enforcement_policies")
    .upsert(
      { ...parsed.data, scope_type: "org", scope_id: ctx.orgId },
      { onConflict: "scope_type,scope_id" },
    )
    .select()
    .single();

  if (error) {
    console.error("[policy] upsert failed:", error);
    return NextResponse.json({ error: "Failed to save policy" }, { status: 500 });
  }

  return NextResponse.json({ policy: data });
}
