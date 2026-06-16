/**
 * /api/prompts/[id]/labels (PRD-4)
 *
 * GET    — list a prompt's labels and the version each points to. Org member.
 * PUT    — promote: point a label (production/staging/…) at a version. Upserts
 *          on (prompt_id, label), so a label always resolves to exactly one
 *          version. Body: { label, version } or { label, version_id }. canWriteOrg.
 * DELETE ?label= — remove a label pointer. canWriteOrg.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";
import { canWriteOrg } from "@/lib/supabase/metrics-scope";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("prompt_labels")
    .select("label, version_id, updated_at, prompt_versions(version)")
    .eq("org_id", member.org_id)
    .eq("prompt_id", params.id);
  if (error) return NextResponse.json({ error: "Failed to fetch labels" }, { status: 500 });
  return NextResponse.json({ labels: data ?? [] });
}

const PutSchema = z.object({
  label:      z.string().min(1).max(50),
  version:    z.number().int().min(1).optional(),
  version_id: z.string().uuid().optional(),
}).refine(d => d.version != null || d.version_id, { message: "Provide version or version_id" });

export async function PUT(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await canWriteOrg(user.id, member.org_id))) {
    return NextResponse.json({ error: "Read-only members cannot set labels" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });

  const admin = createAdminClient();
  // Resolve the target version row (must belong to this prompt + org).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let vq = (admin as any)
    .from("prompt_versions").select("id").eq("prompt_id", params.id).eq("org_id", member.org_id);
  vq = parsed.data.version_id ? vq.eq("id", parsed.data.version_id) : vq.eq("version", parsed.data.version);
  const { data: version } = await vq.maybeSingle();
  if (!version) return NextResponse.json({ error: "Version not found for this prompt" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("prompt_labels")
    .upsert(
      { prompt_id: params.id, org_id: member.org_id, label: parsed.data.label, version_id: version.id, updated_at: new Date().toISOString() },
      { onConflict: "prompt_id,label" },
    );
  if (error) return NextResponse.json({ error: "Failed to set label" }, { status: 500 });
  return NextResponse.json({ ok: true, label: parsed.data.label, version_id: version.id });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await canWriteOrg(user.id, member.org_id))) {
    return NextResponse.json({ error: "Read-only members cannot remove labels" }, { status: 403 });
  }

  const label = new URL(req.url).searchParams.get("label");
  if (!label) return NextResponse.json({ error: "label query param required" }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("prompt_labels")
    .delete()
    .eq("org_id", member.org_id).eq("prompt_id", params.id).eq("label", label);
  if (error) return NextResponse.json({ error: "Failed to remove label" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
