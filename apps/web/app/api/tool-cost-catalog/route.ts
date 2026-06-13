/**
 * GET    /api/tool-cost-catalog       — list entries for the org
 * POST   /api/tool-cost-catalog       — create an entry
 * DELETE /api/tool-cost-catalog?id=…  — delete an entry
 *
 * The tool_cost_catalog table maps tool name patterns to estimated cost per
 * call. The MCP SDK uses these to populate tool_cost_usd before actual
 * infrastructure costs are reconciled.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { z } from "zod";

const CreateSchema = z.object({
  tool_pattern: z.string().min(1).max(200),
  cost_usd:     z.number().min(0),
  description:  z.string().max(500).optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("tool_cost_catalog")
    .select("id, tool_pattern, cost_usd, description, created_at")
    .eq("org_id", member.org_id)
    .order("tool_pattern");

  return NextResponse.json({ data: data ?? [] });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const body = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: insertErr } = await (admin as any)
    .from("tool_cost_catalog")
    .insert({
      org_id:       member.org_id,
      tool_pattern: body.data.tool_pattern,
      cost_usd:     body.data.cost_usd,
      description:  body.data.description ?? null,
    })
    .select("id, tool_pattern, cost_usd, description, created_at")
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("tool_cost_catalog")
    .delete()
    .eq("id", id)
    .eq("org_id", member.org_id);

  return NextResponse.json({ success: true });
}
