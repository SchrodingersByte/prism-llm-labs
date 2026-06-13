/**
 * /api/model-governance/requests/[id] — duplicate of the list/submit route in
 * the dev app (no PATCH resolve handler exists here). Gated identically to
 * /api/model-governance/requests so the POST is not an ungated backdoor:
 * filing a request is an org-writer action (excludes read_only), matching the
 * can_write_org RLS.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { z } from "zod";

const RequestSchema = z.object({
  model:       z.string().min(1),
  api_key_id:  z.string().uuid().optional(),
  environment: z.string().default("production"),
  note:        z.string().max(500).optional(),
});

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const status = req.nextUrl.searchParams.get("status");
  const admin  = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("model_approval_requests" as any)
    .select("id, model, environment, status, note, created_at, reviewed_at, api_key_id, requested_by, reviewed_by")
    .eq("org_id", member.org_id)
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);

  const { data } = await query;
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  // Filing a request is an org-writer action (matches can_write_org RLS):
  // org-scoped owner/administrator/developer only — read_only cannot request.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: roleRow } = await (createAdminClient() as any)
    .from("members").select("role, scope_type").eq("org_id", member.org_id).eq("user_id", user.id).maybeSingle() as { data: { role: string | null; scope_type: string | null } | null };
  if (!(roleRow?.scope_type === "organization" && ["owner", "administrator", "developer"].includes(roleRow.role ?? ""))) {
    return NextResponse.json({ error: "Read-only members cannot request models" }, { status: 403 });
  }

  const body = RequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: insertErr } = await (admin as any)
    .from("model_approval_requests" as any)
    .insert({
      org_id:       member.org_id,
      model:        body.data.model,
      api_key_id:   body.data.api_key_id ?? null,
      environment:  body.data.environment,
      note:         body.data.note ?? null,
      requested_by: user.id,
      status:       "pending",
    })
    .select()
    .single();

  if (insertErr) return NextResponse.json({ error: "Failed to submit request" }, { status: 500 });

  return NextResponse.json({ data }, { status: 201 });
}
