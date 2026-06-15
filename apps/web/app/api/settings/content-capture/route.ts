/**
 * /api/settings/content-capture (PRD-0)
 *
 * GET — list the org's content-capture settings (org default + per-project rows).
 * PUT — upsert one (org,project) setting. Owner/administrator only (canManage).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("content_capture_settings")
    .select("id, project_id, level, payload_ttl_days, embed_enabled, embed_model, residency_override, updated_at")
    .eq("org_id", ctx.orgId)
    .order("project_id", { ascending: true, nullsFirst: true });

  if (error) return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  return NextResponse.json({ settings: data ?? [] });
}

const PutSchema = z.object({
  project_id:         z.string().uuid().nullable().optional(),   // null/omitted = org default
  level:              z.enum(["off", "metadata_only", "redacted_content", "full_content"]),
  payload_ttl_days:   z.number().int().min(1).max(3650).default(30),
  embed_enabled:      z.boolean().default(false),
  embed_model:        z.string().max(100).nullable().optional(),
  residency_override: z.string().max(20).nullable().optional(),
});

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.canManage) {
    return NextResponse.json({ error: "Owner or administrator required" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("content_capture_settings")
    .upsert({
      org_id:             ctx.orgId,
      project_id:         parsed.data.project_id ?? null,
      level:              parsed.data.level,
      payload_ttl_days:   parsed.data.payload_ttl_days,
      embed_enabled:      parsed.data.embed_enabled,
      embed_model:        parsed.data.embed_model ?? null,
      residency_override: parsed.data.residency_override ?? null,
      updated_by:         ctx.user.id,
      updated_at:         new Date().toISOString(),
    }, { onConflict: "org_id,project_id" })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  return NextResponse.json({ id: data?.id }, { status: 200 });
}
