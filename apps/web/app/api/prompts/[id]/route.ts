/**
 * /api/prompts/[id] (PRD-4)
 *
 * GET    — prompt detail: the prompt + all versions (content/config for the diff
 *          view) + current labels. Org member.
 * PATCH  — update the prompt's description. canWriteOrg.
 * DELETE — delete the prompt (cascades versions + labels). canWriteOrg.
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
  const { data: prompt } = await (admin as any)
    .from("prompts")
    .select("id, project_id, name, description, created_at, updated_at")
    .eq("id", params.id)
    .eq("org_id", member.org_id)
    .maybeSingle();
  if (!prompt) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: versions } = await (admin as any)
    .from("prompt_versions")
    .select("id, version, content, config, commit_msg, created_at")
    .eq("prompt_id", params.id)
    .order("version", { ascending: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: labels } = await (admin as any)
    .from("prompt_labels")
    .select("label, version_id, updated_at")
    .eq("prompt_id", params.id);

  return NextResponse.json({ prompt, versions: versions ?? [], labels: labels ?? [] });
}

const PatchSchema = z.object({ description: z.string().max(1000).nullable() });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await canWriteOrg(user.id, member.org_id))) {
    return NextResponse.json({ error: "Read-only members cannot edit prompts" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("prompts")
    .update({ description: parsed.data.description })
    .eq("id", params.id).eq("org_id", member.org_id);
  if (error) return NextResponse.json({ error: "Failed to update prompt" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await canWriteOrg(user.id, member.org_id))) {
    return NextResponse.json({ error: "Read-only members cannot delete prompts" }, { status: 403 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("prompts")
    .delete()
    .eq("id", params.id).eq("org_id", member.org_id);
  if (error) return NextResponse.json({ error: "Failed to delete prompt" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
