/**
 * /api/export-destinations â€” CRUD for telemetry export destinations.
 * Owner/admin only. Supports Langfuse, Helicone, and generic webhooks.
 */

import { NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/billing/feature-guard";
import { z } from "zod";

const CreateSchema = z.object({
  name:         z.string().min(1).max(80),
  type:         z.enum(["webhook", "langfuse", "helicone"]),
  url:          z.string().url(),
  secret_token: z.string().optional(),
  active:       z.boolean().default(true),
});

async function requireAdminMember() {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const member = await getMemberOrg(user.id);
  if (!member) return null;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: m } = await (admin as any)
    .from("members").select("role")
    .eq("org_id", member.org_id).eq("user_id", user.id).maybeSingle() as { data: { role: string } | null };
  if (!m || !["owner", "administrator"].includes(m.role)) return null;
  return { member, admin };
}

export async function GET() {
  const ctx = await requireAdminMember();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (ctx.admin as any)
    .from("export_destinations" as any)
    .select("id, name, type, url, active, created_at")
    .eq("org_id", ctx.member.org_id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: Request) {
  const ctx = await requireAdminMember();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const guard = await checkFeature(ctx.member.org_id, "export_destinations");
  if (guard) return guard;

  const body = await req.json().catch(() => ({}));
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (ctx.admin as any)
    .from("export_destinations" as any)
    .insert({
      org_id:       ctx.member.org_id,
      name:         parsed.data.name,
      type:         parsed.data.type,
      url:          parsed.data.url,
      secret_token: parsed.data.secret_token ?? null,
      active:       parsed.data.active,
    })
    .select("id, name, type, url, active, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
