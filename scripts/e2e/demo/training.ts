/**
 * Phase 5 — Training runs seed.
 * Upserts rows into training_runs on (org_id, provider, run_id).
 */

import { createClient } from "@supabase/supabase-js";
import type { DemoContext } from "./infra";

const SUPABASE_URL         = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) as any;

function daysAgoIso(n: number, hour = 10): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

export async function seedTraining(ctx: DemoContext) {
  const { orgId, projects } = ctx;

  const runs = [
    {
      run_id:          "ft-prod-support-v2",
      provider:        "openai",
      training_type:   "fine_tune",
      display_name:    "Support Bot v2 Fine-tune",
      base_model:      "gpt-4o-mini",
      fine_tuned_model: "ft:gpt-4o-mini:prism:support-v2:xAbc1234",
      status:          "completed",
      started_at:      daysAgoIso(20, 8),
      completed_at:    daysAgoIso(19, 14),
      cost_usd:        42.50,
      tokens_trained:  4_250_000,
      epochs:          3,
      project_id:      projects.customerPlatform,
      cost_center_code: "GL-ENG-01",
      workload_type:   "model_training",
      config:          { training_file: "file-abc123", validation_file: "file-xyz456" },
    },
    {
      run_id:          "ft-prod-support-v3",
      provider:        "openai",
      training_type:   "fine_tune",
      display_name:    "Support Bot v3 Fine-tune (in progress)",
      base_model:      "gpt-4o-mini",
      fine_tuned_model: null,
      status:          "running",
      started_at:      daysAgoIso(1, 6),
      completed_at:    null,
      cost_usd:        null,
      tokens_trained:  null,
      epochs:          4,
      project_id:      projects.customerPlatform,
      cost_center_code: "GL-ENG-01",
      workload_type:   "model_training",
      config:          { training_file: "file-def789" },
    },
    {
      run_id:          "distil-haiku-internal-v1",
      provider:        "anthropic",
      training_type:   "distillation",
      display_name:    "Haiku Distillation — Internal QA Bot",
      base_model:      "claude-3-5-haiku-20241022",
      fine_tuned_model: "claude-distilled-qa-v1",
      status:          "completed",
      started_at:      daysAgoIso(15, 10),
      completed_at:    daysAgoIso(14, 22),
      cost_usd:        18.00,
      tokens_trained:  1_800_000,
      epochs:          2,
      project_id:      projects.mlResearch,
      cost_center_code: "GL-ML-04",
      workload_type:   "model_training",
      config:          { teacher_model: "claude-3-5-sonnet-20241022" },
    },
    {
      run_id:          "embed-v4-training-2026",
      provider:        "gcp_vertex",
      training_type:   "embedding",
      display_name:    "Embedding Model v4 Training",
      base_model:      "textembedding-gecko",
      fine_tuned_model: "embed-v4-prism-2026",
      status:          "completed",
      started_at:      daysAgoIso(28, 9),
      completed_at:    daysAgoIso(27, 16),
      cost_usd:        8.75,
      tokens_trained:  875_000,
      epochs:          1,
      project_id:      projects.dataAnalytics,
      cost_center_code: "GL-DATA-02",
      workload_type:   "model_training",
      config:          { dataset: "gs://prism-datasets/embed-v4-train.jsonl" },
    },
    {
      run_id:          "full-train-research-exp3",
      provider:        "manual",
      training_type:   "full_training",
      display_name:    "Research Full Training Experiment 3",
      base_model:      "llama-3-8b",
      fine_tuned_model: null,
      status:          "failed",
      started_at:      daysAgoIso(10, 14),
      completed_at:    daysAgoIso(10, 16),
      cost_usd:        0,
      tokens_trained:  null,
      epochs:          null,
      project_id:      projects.mlResearch,
      cost_center_code: "GL-ML-04",
      workload_type:   "model_training",
      config:          { error: "OOM on epoch 1: increase batch_size or reduce context" },
    },
  ];

  for (const run of runs) {
    await admin.from("training_runs").upsert(
      { org_id: orgId, ...run },
      { onConflict: "org_id,provider,run_id", ignoreDuplicates: false },
    );
    console.log(`[training] upserted: ${run.run_id} (${run.status})`);
  }
}
