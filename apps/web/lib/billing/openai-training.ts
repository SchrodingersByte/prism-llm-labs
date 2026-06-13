/**
 * OpenAI fine-tuning job sync.
 *
 * Fetches completed fine-tuning jobs from the OpenAI API and upserts them
 * into the training_runs table. Cost is estimated from trained_tokens at
 * the fine-tuning rate (base model input price × FINETUNE_COST_MULTIPLIER).
 *
 * OpenAI fine-tuning pricing:
 *   gpt-4o-mini: $3.00 / 1M training tokens
 *   gpt-3.5-turbo: $8.00 / 1M training tokens
 *   gpt-4o: $25.00 / 1M training tokens
 * These are separate from inference pricing — hardcoded below.
 */

import { SupabaseClient } from "@supabase/supabase-js";

// Fine-tune training cost per 1M tokens (USD), keyed by model prefix
const FINETUNE_COST_PER_1M: Record<string, number> = {
  "gpt-4o-mini":   3.00,
  "gpt-4o":       25.00,
  "gpt-3.5-turbo": 8.00,
  "babbage":       0.40,
  "davinci":       6.00,
};

function getFinetuneCostPer1M(model: string): number {
  for (const [prefix, cost] of Object.entries(FINETUNE_COST_PER_1M)) {
    if (model.startsWith(prefix)) return cost;
  }
  return 8.00; // conservative fallback
}

interface OpenAIFineTuneJob {
  id:              string;
  model:           string;
  fine_tuned_model: string | null;
  status:          string;
  created_at:      number;
  finished_at:     number | null;
  trained_tokens:  number | null;
  error?:          { message?: string } | null;
  hyperparameters?: { n_epochs?: number | string };
  training_file:   string;
}

export async function syncOpenAIFineTuningJobs(
  supabase:    SupabaseClient,
  orgId:       string,
  apiKey:      string,
  projectId?:  string,
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];
  let synced = 0;

  try {
    // Fetch all fine-tuning jobs (paginate if needed)
    const res = await fetch("https://api.openai.com/v1/fine_tuning/jobs?limit=100", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const text = await res.text();
      return { synced: 0, errors: [`OpenAI fine-tuning API error ${res.status}: ${text.slice(0, 200)}`] };
    }

    const json = await res.json() as { data: OpenAIFineTuneJob[] };
    const jobs = json.data ?? [];

    for (const job of jobs) {
      try {
        const trainedTokens = job.trained_tokens ?? 0;
        const costPer1M     = getFinetuneCostPer1M(job.model);
        const costUsd       = (trainedTokens / 1_000_000) * costPer1M;

        const statusMap: Record<string, string> = {
          succeeded:  "completed",
          failed:     "failed",
          cancelled:  "cancelled",
          running:    "running",
          queued:     "pending",
          validating_files: "pending",
        };

        const epochs = typeof job.hyperparameters?.n_epochs === "number"
          ? job.hyperparameters.n_epochs
          : null;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from("training_runs").upsert(
          {
            org_id:           orgId,
            project_id:       projectId ?? null,
            run_id:           job.id,
            provider:         "openai",
            training_type:    "fine_tune",
            base_model:       job.model,
            fine_tuned_model: job.fine_tuned_model ?? null,
            status:           statusMap[job.status] ?? job.status,
            started_at:       job.created_at
              ? new Date(job.created_at * 1000).toISOString()
              : null,
            completed_at:     job.finished_at
              ? new Date(job.finished_at * 1000).toISOString()
              : null,
            cost_usd:         costUsd > 0 ? costUsd : null,
            tokens_trained:   trainedTokens > 0 ? trainedTokens : null,
            epochs:           epochs,
            workload_type:    "model_training",
            config:           { training_file: job.training_file, error: job.error ?? null },
          },
          { onConflict: "org_id,provider,run_id", ignoreDuplicates: false },
        );
        synced++;
      } catch (err) {
        errors.push(`job ${job.id}: ${String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`network error: ${String(err)}`);
  }

  return { synced, errors };
}
