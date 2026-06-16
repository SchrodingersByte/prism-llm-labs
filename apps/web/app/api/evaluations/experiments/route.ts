/**
 * /api/evaluations/experiments (PRD-2)
 *
 * POST — run one subject config (model + optional system prompt + params) over a
 *        dataset, score every sample with the PRD-1 scorer library, and record an
 *        evaluation_runs row (kind='experiment') + per-sample eval_scores. When a
 *        threshold and/or baseline_run_id is supplied, returns a CI gate verdict
 *        ({ passed, regression, score_delta }) — this is what the SDK CI helper
 *        consumes to fail a build on a regression.
 *
 * GET  — list the org's experiment runs (kind='experiment') for the compare/list UI.
 *
 * Auth: a browser session (canWriteOrg) OR a Prism API key (Authorization: Bearer
 *       prism_...). The API-key path is what makes this callable from CI.
 *
 * Runs synchronously within maxDuration=300 (samples capped); the primary
 * consumer is a CI gate that blocks on the result.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";
import { canWriteOrg } from "@/lib/supabase/metrics-scope";
import { authenticateIngestKey } from "@/lib/ingest/auth";
import { runExperiment, type DatasetSample } from "@/lib/eval/runner";
import { resolveProviderKey, providerForModel } from "@/lib/arena/execute";

export const runtime     = "nodejs";
export const maxDuration = 300;

const ScorerEnum = z.enum([
  "rubric", "faithfulness", "answer_relevancy", "context_precision",
  "context_recall", "toxicity", "hallucination", "correctness", "exact_match",
]);

const ItemSchema = z.object({
  input:           z.string().min(1),
  expected_output: z.string().optional(),
  tags:            z.record(z.string()).optional(),
});

const ExperimentSchema = z.object({
  dataset_id:           z.string().uuid().optional(),
  items:                z.array(ItemSchema).min(1).max(200).optional(),
  name:                 z.string().max(200).optional(),
  subject: z.object({
    model:          z.string().min(1),
    system_prompt:  z.string().max(8000).optional(),
    prompt_id:      z.string().uuid().optional(),     // PRD-4: resolve a registry prompt as the subject
    prompt_label:   z.string().max(50).optional(),    // which label to resolve (default 'production')
    prompt_version: z.string().optional(),            // passthrough version label when no prompt_id
    params:         z.record(z.unknown()).optional(),
  }),
  scorers:              z.array(ScorerEnum).min(1).default(["correctness"]),
  judge_model:          z.string().min(1).max(100).default("claude-haiku-4-5"),
  rubric:               z.string().max(4000).optional(),
  provider_key_id:      z.string().uuid().optional(),
  baseline_run_id:      z.string().uuid().optional(),
  git_sha:              z.string().max(64).optional(),
  max_samples:          z.number().int().min(1).max(50).optional(),
  threshold:            z.number().min(0).max(1).optional(),
  regression_threshold: z.number().min(0).max(1).default(0.05),
});

interface ResolvedAuth { orgId: string; projectId: string | null; userId: string | null; }

/** Dual auth: Prism API key (CI) when an Authorization header is present, else browser session. */
async function resolveAuth(req: NextRequest): Promise<ResolvedAuth | NextResponse> {
  const authHeader = req.headers.get("authorization");
  if (authHeader) {
    const res = await authenticateIngestKey(authHeader);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return { orgId: res.key.org_id, projectId: res.key.project_id, userId: res.key.user_id };
  }
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await canWriteOrg(user.id, member.org_id))) {
    return NextResponse.json({ error: "Read-only members cannot run experiments" }, { status: 403 });
  }
  return { orgId: member.org_id, projectId: null, userId: user.id };
}

/**
 * PRD-4 hook: resolve a registry prompt to a concrete system prompt + version
 * label so a prompt version is a first-class experiment subject. Resolves by the
 * given label (default 'production'), falling back to the latest version.
 * Returns null when the prompt id doesn't belong to the org.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolvePromptSubject(admin: any, orgId: string, promptId: string, label?: string): Promise<{ systemPrompt?: string; promptVersion: string } | null> {
  const { data: prompt } = await admin
    .from("prompts").select("name").eq("id", promptId).eq("org_id", orgId).maybeSingle();
  if (!prompt) return null;

  // Try the label pointer first, then the latest version.
  const { data: lab } = await admin
    .from("prompt_labels")
    .select("prompt_versions(version, content)")
    .eq("prompt_id", promptId).eq("label", label ?? "production").maybeSingle();
  let row = (lab?.prompt_versions as { version: number; content: unknown } | null) ?? null;
  if (!row) {
    const { data: latest } = await admin
      .from("prompt_versions").select("version, content")
      .eq("prompt_id", promptId).order("version", { ascending: false }).limit(1).maybeSingle();
    row = latest ?? null;
  }
  if (!row) return null;

  const messages = Array.isArray(row.content) ? row.content as { role?: string; content?: string }[] : [];
  const systemPrompt = messages.find(m => m.role === "system")?.content;
  return { systemPrompt, promptVersion: `${prompt.name}@${row.version}` };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const url    = new URL(req.url);
  const limit  = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const offset = Number(url.searchParams.get("offset") ?? 0);

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, count, error } = await (admin as any)
    .from("evaluation_runs")
    .select("id, name, dataset_id, status, overall_score, n_samples, edge_cases, cost_usd, config_snapshot, baseline_run_id, git_sha, started_at, completed_at, created_at", { count: "exact" })
    .eq("org_id", member.org_id)
    .eq("kind", "experiment")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: "Failed to fetch experiments" }, { status: 500 });
  return NextResponse.json({ experiments: data ?? [], total: count ?? 0, limit, offset });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await resolveAuth(req);
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = ExperimentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });
  }
  const cfg   = parsed.data;
  const admin = createAdminClient();

  // ── Resolve samples (a server dataset, or inline items for CI) ──────────────
  let samples: DatasetSample[] = [];
  if (cfg.dataset_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ds } = await (admin as any)
      .from("evaluation_datasets")
      .select("samples")
      .eq("id", cfg.dataset_id)
      .eq("org_id", auth.orgId)
      .maybeSingle();
    if (!ds) return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
    samples = (Array.isArray(ds.samples) ? ds.samples : []) as DatasetSample[];
  } else if (cfg.items) {
    samples = cfg.items;
  } else {
    return NextResponse.json({ error: "Provide dataset_id or items" }, { status: 422 });
  }
  if (samples.length === 0) return NextResponse.json({ error: "Dataset has no samples" }, { status: 422 });

  // ── Resolve a provider key to execute the subject model ─────────────────────
  const providerKeyId = await resolveProviderKey(admin, auth.orgId, cfg.subject.model, cfg.provider_key_id);
  if (!providerKeyId) {
    const provider = providerForModel(cfg.subject.model) ?? "this model's provider";
    return NextResponse.json({ error: `No active provider key for ${provider}. Add one in Settings → Integrations.` }, { status: 400 });
  }

  // ── PRD-4: resolve a registry prompt into the subject, if referenced ────────
  let resolvedSystemPrompt = cfg.subject.system_prompt;
  let resolvedPromptVersion = cfg.subject.prompt_version ?? null;
  if (cfg.subject.prompt_id) {
    const resolved = await resolvePromptSubject(admin, auth.orgId, cfg.subject.prompt_id, cfg.subject.prompt_label);
    if (!resolved) return NextResponse.json({ error: "Prompt or version not found" }, { status: 404 });
    resolvedSystemPrompt  = resolvedSystemPrompt ?? resolved.systemPrompt;
    resolvedPromptVersion = resolved.promptVersion;
  }
  const subject = { ...cfg.subject, system_prompt: resolvedSystemPrompt };

  // ── Create the run row (kind='experiment') ──────────────────────────────────
  const configSnapshot = {
    model:          cfg.subject.model,
    system_prompt:  resolvedSystemPrompt ?? null,
    prompt_version: resolvedPromptVersion,
    params:         cfg.subject.params ?? null,
    scorers:        cfg.scorers,
    judge_model:    cfg.judge_model,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: runRow, error: runErr } = await (admin as any)
    .from("evaluation_runs")
    .insert({
      org_id:          auth.orgId,
      project_id:      auth.projectId,
      kind:            "experiment",
      mode:            "experiment",
      name:            cfg.name ?? `${cfg.subject.model} · ${new Date().toISOString().slice(0, 10)}`,
      status:          "running",
      dataset_id:      cfg.dataset_id ?? null,
      target_model:    cfg.subject.model,
      n_samples:       Math.min(samples.length, cfg.max_samples ?? 20),
      config_snapshot: configSnapshot,
      git_sha:         cfg.git_sha ?? null,
      baseline_run_id: cfg.baseline_run_id ?? null,
      started_at:      new Date().toISOString(),
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    return NextResponse.json({ error: "Failed to create experiment run" }, { status: 500 });
  }
  const runId = runRow.id as string;

  // ── Execute + score ─────────────────────────────────────────────────────────
  let result;
  try {
    result = await runExperiment(admin, {
      orgId:         auth.orgId,
      runId,
      samples,
      subject,
      providerKeyId,
      scorers:       cfg.scorers,
      judgeModel:    cfg.judge_model,
      rubric:        cfg.rubric,
      maxSamples:    cfg.max_samples,
    });
  } catch (e) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from("evaluation_runs")
      .update({ status: "error", completed_at: new Date().toISOString() })
      .eq("id", runId).eq("org_id", auth.orgId);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Experiment failed", run_id: runId }, { status: 500 });
  }

  // ── CI gate verdict (threshold + regression vs baseline) ────────────────────
  let baselineScore: number | null = null;
  let scoreDelta:    number | null = null;
  let regression = false;
  if (cfg.baseline_run_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: base } = await (admin as any)
      .from("evaluation_runs")
      .select("overall_score")
      .eq("id", cfg.baseline_run_id)
      .eq("org_id", auth.orgId)
      .maybeSingle();
    if (base?.overall_score != null) {
      baselineScore = Number(base.overall_score);
      scoreDelta    = Math.round((result.overall_score - baselineScore) * 1000) / 1000;
      regression    = baselineScore - result.overall_score > cfg.regression_threshold;
    }
  }
  const meetsThreshold = cfg.threshold == null ? true : result.overall_score >= cfg.threshold;
  const passed = meetsThreshold && !regression;

  return NextResponse.json({
    run_id:          runId,
    name:            configSnapshot.model,
    overall_score:   result.overall_score,
    pass_rate:       result.pass_rate,
    n_samples:       result.n_samples,
    edge_cases:      result.edge_cases,
    cost_usd:        result.cost_usd,
    errors:          result.errors,
    threshold:       cfg.threshold ?? null,
    meets_threshold: meetsThreshold,
    baseline_run_id: cfg.baseline_run_id ?? null,
    baseline_score:  baselineScore,
    score_delta:     scoreDelta,
    regression,
    passed,
  }, { status: 201 });
}
