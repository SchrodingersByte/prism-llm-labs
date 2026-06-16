/**
 * /api/prompts/[id]/versions (PRD-4)
 *
 * GET  — list a prompt's versions (newest first). Org member.
 * POST — append a NEW immutable version (version = max + 1). canWriteOrg.
 *        Body: { content: messages[], config?, commit_msg? }. Versions are never
 *        edited — the DB trigger blocks UPDATE; this route only inserts.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";
import { canWriteOrg } from "@/lib/supabase/metrics-scope";

export const runtime = "nodejs";

const MessageSchema = z.object({
  role:    z.enum(["system", "user", "assistant"]),
  content: z.string(),
});
const AppendSchema = z.object({
  content:    z.array(MessageSchema).min(1).max(100),
  config:     z.record(z.unknown()).optional(),
  commit_msg: z.string().max(500).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("prompt_versions")
    .select("id, version, content, config, commit_msg, created_at")
    .eq("org_id", member.org_id)
    .eq("prompt_id", params.id)
    .order("version", { ascending: false });
  if (error) return NextResponse.json({ error: "Failed to fetch versions" }, { status: 500 });
  return NextResponse.json({ versions: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await canWriteOrg(user.id, member.org_id))) {
    return NextResponse.json({ error: "Read-only members cannot add versions" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = AppendSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });

  const admin = createAdminClient();
  // Confirm the prompt belongs to this org.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prompt } = await (admin as any)
    .from("prompts").select("id").eq("id", params.id).eq("org_id", member.org_id).maybeSingle();
  if (!prompt) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });

  // version = max + 1; retry once on the UNIQUE(prompt_id, version) race.
  for (let attempt = 0; attempt < 2; attempt++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: top } = await (admin as any)
      .from("prompt_versions").select("version").eq("prompt_id", params.id)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    const nextVersion = (top?.version ?? 0) + 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any)
      .from("prompt_versions")
      .insert({
        prompt_id:  params.id,
        org_id:     member.org_id,
        version:    nextVersion,
        content:    parsed.data.content,
        config:     parsed.data.config ?? {},
        commit_msg: parsed.data.commit_msg ?? null,
        created_by: user.id,
      })
      .select("id, version")
      .single();

    if (!error && data) {
      // Touch the prompt so list ordering reflects the new version.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from("prompts").update({ updated_at: new Date().toISOString() }).eq("id", params.id);
      return NextResponse.json({ id: data.id, version: data.version }, { status: 201 });
    }
    if ((error as { code?: string })?.code !== "23505") {
      return NextResponse.json({ error: "Failed to add version" }, { status: 500 });
    }
    // else: concurrent append took our version number — loop and recompute.
  }
  return NextResponse.json({ error: "Version conflict, please retry" }, { status: 409 });
}
