import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { encryptKey } from "@/lib/crypto/keys";
import { z } from "zod";

const PatchSchema = z.object({
  display_name:     z.string().min(1).max(100).optional(),
  attribution_mode: z.enum(["proportional", "tag_based"]).optional(),
  config:           z.record(z.unknown()).optional(),
  credentials:      z.record(z.string()).optional(),  // re-encrypt if provided
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  // Cloud billing connections hold provider credentials → owner/administrator only.
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const body = PatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message }, { status: 400 });

  const updates: Record<string, unknown> = {};
  if (body.data.display_name)     updates.display_name     = body.data.display_name;
  if (body.data.attribution_mode) updates.attribution_mode = body.data.attribution_mode;
  if (body.data.config)           updates.config           = body.data.config;
  if (body.data.credentials && Object.keys(body.data.credentials).length > 0) {
    updates.credentials_encrypted = encryptKey(JSON.stringify(body.data.credentials));
  }

  if (!Object.keys(updates).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: updateErr } = await (admin as any)
    .from("cloud_billing_connections")
    .update(updates)
    .eq("id", params.id)
    .eq("org_id", member.org_id)
    .select("id, provider, display_name, config, attribution_mode, last_synced_at, last_sync_status, last_sync_cost_usd")
    .single();

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbErr } = await (admin as any)
    .from("cloud_billing_connections")
    .delete()
    .eq("id", params.id)
    .eq("org_id", member.org_id);   // scoped to org — no cross-org delete

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
