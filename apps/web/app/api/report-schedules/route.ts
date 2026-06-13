/**
 * GET  /api/report-schedules  — list org's report delivery schedules
 * POST /api/report-schedules  — create a new schedule (owner/admin only)
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const CreateSchema = z.object({
  frequency:     z.enum(["daily", "weekly", "monthly"]),
  recipients:    z.array(z.string().email()).min(1).max(20),
  format:        z.enum(["pdf", "csv"]).default("pdf"),
  day_of_week:   z.number().int().min(0).max(6).optional(),   // 0=Sun, weekly only
  day_of_month:  z.number().int().min(1).max(28).optional(),  // monthly only
});

export async function GET() {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("report_schedules")
    .select("id, frequency, recipients, format, day_of_week, day_of_month, is_active, last_sent_at, created_at")
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
    .from("report_schedules")
    .insert({
      org_id:       ctx.orgId,
      frequency:    parsed.data.frequency,
      recipients:   parsed.data.recipients,
      format:       parsed.data.format,
      day_of_week:  parsed.data.day_of_week  ?? null,
      day_of_month: parsed.data.day_of_month ?? null,
    })
    .select("id, frequency, recipients, format, day_of_week, day_of_month, is_active, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
