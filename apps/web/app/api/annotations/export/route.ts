/**
 * /api/annotations/export (PRD-3 → PRD-2)
 *
 * POST — turn reviewed annotation-queue items into a dataset (PRD-2). Each item's
 *        trace becomes a sample: the user question is `input`, the model output is
 *        `expected_output`, and the human score/verdict ride along in `tags`. This
 *        is the loop that converts human review into regression datasets.
 *
 * Body: { name (create) | dataset_id (append), description?, queue_ids?, status? }.
 * canWriteOrg. Reuses the inline evaluation_datasets.samples jsonb (≤500 cap).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";
import { canWriteOrg } from "@/lib/supabase/metrics-scope";

export const runtime = "nodejs";

const MAX_SAMPLES = 500;

const ExportSchema = z.object({
  dataset_id:  z.string().uuid().optional(),
  name:        z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  queue_ids:   z.array(z.string().uuid()).min(1).max(MAX_SAMPLES).optional(),
  status:      z.enum(["done", "in_review", "pending", "skipped"]).default("done"),
}).refine(d => d.dataset_id || d.name, { message: "Provide dataset_id (append) or name (create)" });

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
    return NextResponse.json({ error: "Read-only members cannot export" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = ExportSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });
  const { dataset_id, name, description, queue_ids, status } = parsed.data;

  const admin = createAdminClient();

  // 1. Resolve the annotation items to export.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let itemsQ = (admin as any)
    .from("annotation_queue")
    .select("trace_id, span_id, reason")
    .eq("org_id", member.org_id)
    .not("trace_id", "is", null)
    .limit(MAX_SAMPLES);
  itemsQ = queue_ids ? itemsQ.in("id", queue_ids) : itemsQ.eq("status", status);
  const { data: items } = await itemsQ;
  const list = (items ?? []) as { trace_id: string; span_id: string | null; reason: string | null }[];
  if (list.length === 0) return NextResponse.json({ error: "No matching annotation items" }, { status: 422 });

  const traceIds = Array.from(new Set(list.map(i => i.trace_id)));

  // 2. Pull the traces' content + the human scores in two batched reads.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: logs } = await (admin as any)
    .from("request_logs")
    .select("trace_id, model, prompt, completion")
    .eq("org_id", member.org_id)
    .in("trace_id", traceIds)
    .not("completion", "is", null);
  const logByTrace = new Map<string, { model: string; prompt: unknown; completion: unknown }>();
  for (const l of (logs ?? []) as { trace_id: string; model: string; prompt: unknown; completion: unknown }[]) {
    if (!logByTrace.has(l.trace_id)) logByTrace.set(l.trace_id, l);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: scores } = await (admin as any)
    .from("eval_scores")
    .select("trace_id, score, passed")
    .eq("org_id", member.org_id)
    .eq("scorer_type", "human")
    .in("trace_id", traceIds);
  const scoreByTrace = new Map<string, { score: number | null; passed: boolean | null }>();
  for (const s of (scores ?? []) as { trace_id: string; score: number | null; passed: boolean | null }[]) {
    if (!scoreByTrace.has(s.trace_id)) scoreByTrace.set(s.trace_id, s);
  }

  // 3. Build dataset samples.
  const samples = list.map(i => {
    const log = logByTrace.get(i.trace_id);
    if (!log) return null;
    const input    = extractQuestion(log.prompt);
    const expected = typeof log.completion === "string" ? log.completion : String(log.completion ?? "");
    if (!input || !expected) return null;
    const hs = scoreByTrace.get(i.trace_id);
    const tags: Record<string, string> = { source: "annotation", trace_id: i.trace_id, model: log.model };
    if (i.reason) tags.reason = i.reason;
    if (hs?.score != null) tags.human_score = String(hs.score);
    if (hs?.passed != null) tags.human_pass = String(hs.passed);
    return { input, expected_output: expected, tags };
  }).filter(Boolean) as { input: string; expected_output: string; tags: Record<string, string> }[];

  if (samples.length === 0) {
    return NextResponse.json({ error: "No exportable content (traces missing captured prompt/completion)" }, { status: 422 });
  }

  // 4. Append to an existing dataset, or create a new one.
  if (dataset_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ds } = await (admin as any)
      .from("evaluation_datasets").select("samples").eq("id", dataset_id).eq("org_id", member.org_id).maybeSingle();
    if (!ds) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    const existing = Array.isArray(ds.samples) ? ds.samples : [];
    const merged   = [...existing, ...samples].slice(0, MAX_SAMPLES);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from("evaluation_datasets").update({ samples: merged }).eq("id", dataset_id).eq("org_id", member.org_id);
    if (error) return NextResponse.json({ error: "Failed to update dataset" }, { status: 500 });
    return NextResponse.json({ dataset_id, added: merged.length - existing.length, total: merged.length });
  }

  const capped = samples.slice(0, MAX_SAMPLES);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: created, error } = await (admin as any)
    .from("evaluation_datasets")
    .insert({ org_id: member.org_id, name, description: description ?? null, samples: capped })
    .select("id").single();
  if (error || !created) return NextResponse.json({ error: "Failed to create dataset" }, { status: 500 });
  return NextResponse.json({ dataset_id: created.id, added: capped.length, total: capped.length }, { status: 201 });
}
