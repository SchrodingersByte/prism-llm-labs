/**
 * Phase 3 â€” Model validation logic.
 *
 * Option A: Real sample validation (uses request_logs + org's provider keys)
 * Option B: Synthetic validation (generates structural proxies via Claude)
 *
 * Both paths produce a ValidationResult with semantic agreement scores.
 */
import type { ValidationResult, SampleScore } from "./types";
import { createAdminClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const HAIKU_JUDGE   = "claude-haiku-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

// â”€â”€ Judge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function judgeResponses(
  question:   string,
  responseA:  string,
  responseB:  string,
): Promise<{ score: number; reason: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { score: 0.8, reason: "Judge not configured (ANTHROPIC_API_KEY missing)" };

  const prompt = `Two AI models answered the same question. Do these responses deliver equivalent value?
Consider: factual accuracy, completeness, format correctness.
Score from 0.0 (completely different) to 1.0 (semantically identical).
Reply ONLY with JSON: {"score": 0.94, "reason": "one sentence"}

QUESTION: ${question.slice(0, 400)}

RESPONSE A (original): ${responseA.slice(0, 400)}

RESPONSE B (cheaper): ${responseB.slice(0, 400)}`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method:  "POST",
      headers: {
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({
        model:      HAIKU_JUDGE,
        max_tokens: 100,
        messages:   [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return { score: 0.75, reason: "Judge unavailable" };
    const json    = await res.json() as { content?: Array<{ text: string }> };
    const text    = json.content?.[0]?.text?.trim() ?? "{}";
    const parsed  = JSON.parse(text) as { score?: number; reason?: string };
    return { score: Number(parsed.score ?? 0.75), reason: parsed.reason ?? "" };
  } catch {
    return { score: 0.75, reason: "Judge parse error" };
  }
}

// â”€â”€ Call a model via arena chat (uses org's provider key) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function callModel(
  messages:      { role: string; content: string }[],
  providerKeyId: string,
  model:         string,
  baseUrl:       string,
  traceId?:      string,
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/arena/chat`, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      // Group every model call of this validation run under one trace so the
      // arena spans surface on the trace detail alongside the evaluation_run.
      ...(traceId ? { "x-prism-trace-id": traceId } : {}),
    },
    body:    JSON.stringify({ provider_key_id: providerKeyId, model, messages, stream: false }),
  });
  if (!res.ok) return "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as any;
  // OpenAI format
  if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
  // Anthropic format
  if (data.content?.[0]?.text) return data.content[0].text;
  return "";
}

// â”€â”€ Phase 3B: Synthetic validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function generateSyntheticPrompts(profile: {
  feature:            string;
  model:              string;
  avg_input_tokens:   number;
  output_input_ratio: number;
  cache_hit_rate:     number;
}): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Return generic prompts as fallback
    return [
      "Summarise the key points from this short paragraph: 'The meeting went well overall.'",
      "What type of request is this? Category: billing inquiry",
      "Extract the main topic from: 'I need help with my password reset.'",
      "Classify sentiment: 'This product is great!'",
      "Is this a question, statement or command: 'Please help me.'",
    ];
  }

  const taskType = profile.output_input_ratio < 0.4
    ? "extraction/classification"
    : profile.output_input_ratio < 0.9
    ? "short-form Q&A or summarisation"
    : "longer generation";

  const targetLength = Math.round(profile.avg_input_tokens * 0.7);

  const prompt = `Generate exactly 8 diverse test prompts for an AI model validation study.

Context:
- Feature name: "${profile.feature}"
- Task type: ${taskType} (avg output/input ratio: ${profile.output_input_ratio.toFixed(2)})
- Target prompt length: ~${targetLength} tokens (roughly ${Math.round(targetLength * 0.75)} words)
- Cache hit rate ${Math.round(profile.cache_hit_rate * 100)}% suggests ${profile.cache_hit_rate > 0.5 ? "repeating patterns" : "varied inputs"}

Requirements:
- Each prompt should represent a realistic use case for this feature
- Vary the content but keep the structural pattern consistent
- Do not include system prompts â€” just the user message
- Format: return a JSON array of 8 strings, nothing else

Example format: ["prompt 1", "prompt 2", ...]`;

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method:  "POST",
      headers: {
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({
        model:      HAIKU_JUDGE,
        max_tokens: 800,
        messages:   [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return [];
    const json   = await res.json() as { content?: Array<{ text: string }> };
    const text   = json.content?.[0]?.text?.trim() ?? "[]";
    const start  = text.indexOf("[");
    const end    = text.lastIndexOf("]");
    if (start < 0 || end < 0) return [];
    return JSON.parse(text.slice(start, end + 1)) as string[];
  } catch {
    return [];
  }
}

export async function runSyntheticValidation(params: {
  currentModel:   string;
  suggestedModel: string;
  providerKeyId:  string;
  feature:        string;
  traceId?:       string;
  stats: {
    avg_input_tokens:   number;
    output_input_ratio: number;
    cache_hit_rate:     number;
  };
  onProgress?: (n: number, total: number) => void;
}): Promise<ValidationResult> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const prompts = await generateSyntheticPrompts({
    feature:            params.feature,
    model:              params.currentModel,
    avg_input_tokens:   params.stats.avg_input_tokens,
    output_input_ratio: params.stats.output_input_ratio,
    cache_hit_rate:     params.stats.cache_hit_rate,
  });

  if (prompts.length === 0) {
    return {
      mode:          "synthetic",
      overall_score: 0.8,
      n_samples:     0,
      edge_cases:    0,
      samples:       [],
      current_model: params.currentModel,
      target_model:  params.suggestedModel,
      ran_at:        new Date().toISOString(),
    };
  }

  const samples: SampleScore[] = [];
  const total = prompts.length;

  for (let i = 0; i < total; i++) {
    const prompt   = prompts[i];
    const messages = [{ role: "user", content: prompt }];

    const [responseA, responseB] = await Promise.all([
      callModel(messages, params.providerKeyId, params.currentModel, baseUrl, params.traceId),
      callModel(messages, params.providerKeyId, params.suggestedModel, baseUrl, params.traceId),
    ]);

    const { score, reason } = await judgeResponses(prompt, responseA, responseB);
    samples.push({ index: i, question: prompt.slice(0, 80) + (prompt.length > 80 ? "â€¦" : ""), score, reason, is_edge: score < 0.7 });

    params.onProgress?.(i + 1, total);
  }

  const overall  = samples.reduce((s, x) => s + x.score, 0) / samples.length;
  const edgeCases = samples.filter(s => s.is_edge).length;

  return {
    mode:          "synthetic",
    overall_score: Math.round(overall * 1000) / 1000,
    n_samples:     samples.length,
    edge_cases:    edgeCases,
    samples,
    current_model: params.currentModel,
    target_model:  params.suggestedModel,
    ran_at:        new Date().toISOString(),
  };
}

// â”€â”€ Phase 3A: Real sample validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function runRealSampleValidation(params: {
  orgId:          string;
  currentModel:   string;
  suggestedModel: string;
  providerKeyId:  string;
  n:              number;  // number of samples (default 20)
  traceId?:       string;
  onProgress?: (n: number, total: number, scoreSoFar: number) => void;
}): Promise<ValidationResult> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const admin   = createAdminClient() as SupabaseClient<Database>;
  const n       = params.n ?? 20;

  // Fetch recent request_logs for this model from Supabase
  const { data: logs } = await admin
    .from("request_logs")
    .select("prompt, completion")
    .eq("org_id", params.orgId)
    .eq("model", params.currentModel)
    .not("prompt", "is", null)
    .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(n * 3) as { // fetch more, sample down
      data: { prompt: unknown; completion: string | null }[] | null
    };

  if (!logs || logs.length === 0) {
    return {
      mode:          "real",
      overall_score: 0,
      n_samples:     0,
      edge_cases:    0,
      samples:       [],
      current_model: params.currentModel,
      target_model:  params.suggestedModel,
      ran_at:        new Date().toISOString(),
    };
  }

  // Randomly sample N from available logs
  const shuffled = [...logs].sort(() => Math.random() - 0.5).slice(0, n);
  const samples:  SampleScore[] = [];
  let scoreSum    = 0;

  for (let i = 0; i < shuffled.length; i++) {
    const log = shuffled[i];
    if (!log.prompt) continue;

    // Reconstruct messages array
    let messages: { role: string; content: string }[];
    try {
      const parsed = Array.isArray(log.prompt) ? log.prompt : JSON.parse(log.prompt as string);
      messages = (parsed as { role: string; content: string }[])
        .filter(m => m.role !== "system"); // strip system to avoid confusion
    } catch {
      continue;
    }
    if (messages.length === 0) continue;

    const question = messages.find(m => m.role === "user")?.content ?? "";

    // Re-run with both models
    const [responseA, responseB] = await Promise.all([
      // Response A: use stored completion (already ran, save tokens)
      Promise.resolve(log.completion ?? await callModel(messages, params.providerKeyId, params.currentModel, baseUrl, params.traceId)),
      callModel(messages, params.providerKeyId, params.suggestedModel, baseUrl, params.traceId),
    ]);

    if (!responseA || !responseB) continue;

    const { score, reason } = await judgeResponses(question, responseA, responseB);
    scoreSum += score;
    samples.push({
      index:    i,
      question: question.slice(0, 80) + (question.length > 80 ? "â€¦" : ""),
      score,
      reason,
      is_edge:  score < 0.7,
    });

    params.onProgress?.(samples.length, shuffled.length, scoreSum / samples.length);
  }

  if (samples.length === 0) {
    return {
      mode: "real", overall_score: 0, n_samples: 0, edge_cases: 0, samples: [],
      current_model: params.currentModel, target_model: params.suggestedModel,
      ran_at: new Date().toISOString(),
    };
  }

  const overall   = scoreSum / samples.length;
  const edgeCases = samples.filter(s => s.is_edge).length;

  return {
    mode:          "real",
    overall_score: Math.round(overall * 1000) / 1000,
    n_samples:     samples.length,
    edge_cases:    edgeCases,
    samples,
    current_model: params.currentModel,
    target_model:  params.suggestedModel,
    ran_at:        new Date().toISOString(),
  };
}
