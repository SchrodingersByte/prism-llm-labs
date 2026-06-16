/**
 * /api/prompts/resolve (PRD-4)
 *
 * GET ?name=&label=&version=&project_id= — resolve a prompt to a concrete version
 * for execution. This is what the SDK getPrompt() calls.
 *
 * Resolution order: explicit ?version= → ?label= → label "production" → latest
 * version. Returns { name, version, content, config, prompt_version } where
 * prompt_version = "name@version" — the caller stamps it as tags['prompt_version']
 * so the existing spend_by_prompt_version attribution lights up.
 *
 * Auth: a Prism API key (Authorization: Bearer prism_… — the SDK path) OR a
 * browser session (the playground).
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";
import { authenticateIngestKey } from "@/lib/ingest/auth";

export const runtime = "nodejs";

async function resolveOrg(req: NextRequest): Promise<string | NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const res = await authenticateIngestKey(authHeader);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return res.key.org_id;
  }
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  return member.org_id;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const org = await resolveOrg(req);
  if (org instanceof NextResponse) return org;

  const url       = new URL(req.url);
  const name      = url.searchParams.get("name");
  const label     = url.searchParams.get("label") ?? undefined;
  const version   = url.searchParams.get("version") ?? undefined;
  const projectId = url.searchParams.get("project_id") ?? undefined;
  if (!name) return NextResponse.json({ error: "name query param required" }, { status: 400 });

  const admin = createAdminClient();
  // Find the prompt by name. Prefer the project match, else the org-level (null) prompt, else first.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prompts } = await (admin as any)
    .from("prompts").select("id, project_id").eq("org_id", org).eq("name", name);
  const list = (prompts ?? []) as { id: string; project_id: string | null }[];
  const prompt = projectId
    ? list.find(p => p.project_id === projectId)
    : (list.find(p => p.project_id === null) ?? list[0]);
  if (!prompt) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });

  // Resolve the version row.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pvSel = (col: string, val: string | number) => (admin as any)
    .from("prompt_versions").select("version, content, config")
    .eq("prompt_id", prompt.id).eq(col, val).maybeSingle();

  let row: { version: number; content: unknown; config: unknown } | null = null;
  if (version) {
    const { data } = await pvSel("version", Number(version));
    row = data ?? null;
  } else {
    const labelToUse = label ?? "production";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: lab } = await (admin as any)
      .from("prompt_labels")
      .select("prompt_versions(version, content, config)")
      .eq("prompt_id", prompt.id).eq("label", labelToUse).maybeSingle();
    row = (lab?.prompt_versions as { version: number; content: unknown; config: unknown } | null) ?? null;

    // No (matching) label — fall back to the latest version, unless an explicit label was requested.
    if (!row && !label) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: latest } = await (admin as any)
        .from("prompt_versions").select("version, content, config")
        .eq("prompt_id", prompt.id).order("version", { ascending: false }).limit(1).maybeSingle();
      row = latest ?? null;
    }
  }

  if (!row) return NextResponse.json({ error: "No matching version" }, { status: 404 });
  return NextResponse.json({
    name,
    version:        row.version,
    content:        row.content,
    config:         row.config ?? {},
    prompt_version: `${name}@${row.version}`,
  });
}
