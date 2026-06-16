/**
 * /api/prompts (PRD-4 — prompt registry)
 *
 * GET  — list the org's prompts with their labels + latest version (org member).
 * POST — create a named prompt (canWriteOrg). Versions are added via
 *        /api/prompts/[id]/versions; labels via /api/prompts/[id]/labels.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";
import { canWriteOrg } from "@/lib/supabase/metrics-scope";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const url       = new URL(req.url);
  const projectId = url.searchParams.get("project_id") ?? undefined;
  const admin     = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (admin as any)
    .from("prompts")
    .select("id, project_id, name, description, created_at, updated_at")
    .eq("org_id", member.org_id)
    .order("updated_at", { ascending: false });
  if (projectId) q = q.eq("project_id", projectId);
  const { data: prompts, error } = await q;
  if (error) return NextResponse.json({ error: "Failed to fetch prompts" }, { status: 500 });

  const ids = (prompts ?? []).map((p: { id: string }) => p.id);
  // Labels + latest version per prompt (two batched reads; mapped in JS).
  const labelsByPrompt = new Map<string, { label: string; version: number }[]>();
  const latestByPrompt = new Map<string, number>();
  if (ids.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: labels } = await (admin as any)
      .from("prompt_labels")
      .select("prompt_id, label, prompt_versions(version)")
      .eq("org_id", member.org_id)
      .in("prompt_id", ids);
    for (const l of (labels ?? []) as { prompt_id: string; label: string; prompt_versions: { version: number } | null }[]) {
      if (!labelsByPrompt.has(l.prompt_id)) labelsByPrompt.set(l.prompt_id, []);
      labelsByPrompt.get(l.prompt_id)!.push({ label: l.label, version: l.prompt_versions?.version ?? 0 });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: versions } = await (admin as any)
      .from("prompt_versions")
      .select("prompt_id, version")
      .in("prompt_id", ids);
    for (const v of (versions ?? []) as { prompt_id: string; version: number }[]) {
      latestByPrompt.set(v.prompt_id, Math.max(latestByPrompt.get(v.prompt_id) ?? 0, v.version));
    }
  }

  const out = (prompts ?? []).map((p: { id: string }) => ({
    ...p,
    latest_version: latestByPrompt.get(p.id) ?? 0,
    labels:         labelsByPrompt.get(p.id) ?? [],
  }));
  return NextResponse.json({ prompts: out });
}

const CreatePromptSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  project_id:  z.string().uuid().nullable().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await canWriteOrg(user.id, member.org_id))) {
    return NextResponse.json({ error: "Read-only members cannot create prompts" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreatePromptSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("prompts")
    .insert({
      org_id:      member.org_id,
      project_id:  parsed.data.project_id ?? null,
      name:        parsed.data.name,
      description: parsed.data.description ?? null,
      created_by:  user.id,
    })
    .select("id")
    .single();

  if (error) {
    // 23505 = unique_violation on (org_id, project_id, name)
    const code = (error as { code?: string }).code;
    if (code === "23505") return NextResponse.json({ error: "A prompt with that name already exists" }, { status: 409 });
    return NextResponse.json({ error: "Failed to create prompt" }, { status: 500 });
  }
  return NextResponse.json({ id: data.id }, { status: 201 });
}
