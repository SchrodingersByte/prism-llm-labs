/**
 * /api/evaluations/datasets/from-traces (PRD-2)
 *
 * POST — turn captured production traces (request_logs, PRD-0 content) into
 *        dataset samples: each log's user question becomes `input` and its stored
 *        completion becomes `expected_output`. Appends to an existing dataset
 *        (dataset_id) or creates a new one (name). This is the
 *        "build-dataset-from-traces" workflow LangSmith/Datadog center on.
 *
 * Writes require canWriteOrg (read_only blocked). v1 stays on the inline
 * evaluation_datasets.samples jsonb array (≤500 samples).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";
import { canWriteOrg } from "@/lib/supabase/metrics-scope";

export const runtime = "nodejs";

const MAX_SAMPLES = 500;   // inline jsonb cap (matches datasets POST)

const FromTracesSchema = z.object({
  dataset_id:  z.string().uuid().optional(),
  name:        z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  filter: z.object({
    project_id:  z.string().uuid().optional(),
    model:       z.string().optional(),
    since_hours: z.number().int().min(1).max(2160).default(168),  // default 7d, max 90d
    limit:       z.number().int().min(1).max(MAX_SAMPLES).default(100),
  }).default({ since_hours: 168, limit: 100 }),
}).refine(d => d.dataset_id || d.name, { message: "Provide dataset_id (append) or name (create)" });

/** Pull the latest user message out of a request_logs.prompt (string | message[]). */
function extractQuestion(prompt: unknown): string {
  if (typeof prompt === "string") return prompt;
  if (Array.isArray(prompt)) {
    for (let k = prompt.length - 1; k >= 0; k--) {
      const m = prompt[k] as { role?: string; content?: unknown };
      if (m?.role === "user") return typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    }
  }
  return "";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await canWriteOrg(user.id, member.org_id))) {
    return NextResponse.json({ error: "Read-only members cannot build datasets" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = FromTracesSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });
  const { dataset_id, name, description, filter } = parsed.data;

  const admin = createAdminClient();
  const since = new Date(Date.now() - filter.since_hours * 3_600_000).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (admin as any)
    .from("request_logs")
    .select("model, prompt, completion")
    .eq("org_id", member.org_id)
    .not("completion", "is", null)
    .not("prompt", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(filter.limit);
  if (filter.project_id) q = q.eq("project_id", filter.project_id);
  if (filter.model)      q = q.eq("model", filter.model);

  const { data: logs, error: logErr } = await q;
  if (logErr) return NextResponse.json({ error: "Failed to read traces" }, { status: 500 });

  const newSamples = (logs ?? [])
    .map((l: { model: string; prompt: unknown; completion: unknown }) => {
      const input = extractQuestion(l.prompt);
      const expected = typeof l.completion === "string" ? l.completion : String(l.completion ?? "");
      if (!input || !expected) return null;
      return { input, expected_output: expected, tags: { model: l.model, source: "trace" } };
    })
    .filter(Boolean) as { input: string; expected_output: string; tags: Record<string, string> }[];

  if (newSamples.length === 0) {
    return NextResponse.json({ error: "No usable traces matched the filter (need captured prompt + completion content)" }, { status: 422 });
  }

  // ── Append to an existing dataset, or create a new one ──────────────────────
  if (dataset_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ds } = await (admin as any)
      .from("evaluation_datasets")
      .select("samples")
      .eq("id", dataset_id)
      .eq("org_id", member.org_id)
      .maybeSingle();
    if (!ds) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });

    const existing = Array.isArray(ds.samples) ? ds.samples : [];
    const merged   = [...existing, ...newSamples].slice(0, MAX_SAMPLES);
    const added    = merged.length - existing.length;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from("evaluation_datasets")
      .update({ samples: merged })
      .eq("id", dataset_id)
      .eq("org_id", member.org_id);
    if (error) return NextResponse.json({ error: "Failed to update dataset" }, { status: 500 });

    return NextResponse.json({ dataset_id, added, total: merged.length, capped: added < newSamples.length });
  }

  const samples = newSamples.slice(0, MAX_SAMPLES);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: created, error } = await (admin as any)
    .from("evaluation_datasets")
    .insert({ org_id: member.org_id, name, description: description ?? null, samples })
    .select("id")
    .single();
  if (error || !created) return NextResponse.json({ error: "Failed to create dataset" }, { status: 500 });

  return NextResponse.json({ dataset_id: created.id, added: samples.length, total: samples.length, capped: samples.length < newSamples.length }, { status: 201 });
}
