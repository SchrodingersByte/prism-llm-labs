/**
 * Phase 2 — Claude Haiku narrative generation for recommendations.
 * Uses raw fetch (no Anthropic SDK dep) to generate a 2-3 sentence
 * explanation + risk note. Results are cached in recommendation_narratives.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { createHash } from "crypto";
import type { Recommendation } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const HAIKU_MODEL = "claude-haiku-4-5";

function statsHash(rec: Recommendation): string {
  const key = JSON.stringify({
    type: rec.type,
    savings: Math.round(rec.potential_savings_usd),
    cost: Math.round((rec.stats?.current_cost ?? 0) * 10),
    ratio: Math.round((rec.stats?.output_input_ratio ?? 0) * 100),
    cache: Math.round((rec.stats?.cache_hit_rate ?? 0) * 100),
  });
  return createHash("md5").update(key).digest("hex").slice(0, 8);
}

function buildPrompt(rec: Recommendation): string {
  const s = rec.stats ?? {};
  const lines = [
    `Analyse this model cost recommendation for a developer platform:`,
    ``,
    `Type: ${rec.type.replace(/_/g, " ")}`,
    rec.feature    ? `Feature: ${rec.feature}` : "",
    rec.current_model   ? `Current model: ${rec.current_model}` : "",
    rec.suggested_model ? `Suggested model: ${rec.suggested_model}` : "",
    s.requests          ? `Calls (30d): ${s.requests.toLocaleString()}` : "",
    s.current_cost      ? `Monthly cost: $${s.current_cost.toFixed(2)}` : "",
    s.avg_input_tokens  ? `Avg input tokens: ${Math.round(s.avg_input_tokens)}` : "",
    s.p95_input_tokens  ? `p95 input tokens: ${Math.round(s.p95_input_tokens)}` : "",
    s.output_input_ratio !== undefined ? `Output/input ratio: ${s.output_input_ratio.toFixed(2)}` : "",
    s.cache_hit_rate    !== undefined  ? `Cache hit rate: ${Math.round(s.cache_hit_rate * 100)}%` : "",
    s.error_rate        !== undefined  ? `Error rate: ${(s.error_rate * 100).toFixed(1)}%` : "",
    `Estimated savings: $${rec.potential_savings_usd.toFixed(2)}/month`,
    `Confidence: ${Math.round(rec.confidence * 100)}%`,
    ``,
    `Write 2–3 sentences: (1) why the data supports this recommendation, (2) one specific risk to watch for after switching. Be direct and technical. No fluff, no bullet points.`,
  ].filter(Boolean).join("\n");
  return lines;
}

/**
 * Fetch or generate a narrative for a recommendation.
 * Returns the narrative string (or a generic fallback on error).
 */
export async function getNarrative(
  orgId: string,
  rec:   Recommendation,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return "";   // silently skip if not configured

  const hash  = statsHash(rec);
  const admin = createAdminClient() as SupabaseClient<Database>;

  // ── Check cache ───────────────────────────────────────────────────────────
  try {
    const { data: cached } = await admin
      .from("recommendation_narratives")
      .select("narrative, stats_hash, generated_at")
      .eq("org_id", orgId)
      .eq("rec_key", rec.id)
      .maybeSingle() as { data: { narrative: string; stats_hash: string; generated_at: string } | null };

    if (cached) {
      const ageH = (Date.now() - new Date(cached.generated_at).getTime()) / 3_600_000;
      // Fresh if < 24h AND stats haven't changed significantly
      if (ageH < 24 && cached.stats_hash === hash) {
        return cached.narrative;
      }
    }
  } catch { /* fall through to generation */ }

  // ── Generate via Claude Haiku ─────────────────────────────────────────────
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":         apiKey,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({
        model:      HAIKU_MODEL,
        max_tokens: 300,
        messages:   [{ role: "user", content: buildPrompt(rec) }],
      }),
    });

    if (!res.ok) return "";

    const json    = await res.json() as { content?: Array<{ text: string }> };
    const text    = json.content?.[0]?.text?.trim() ?? "";
    if (!text) return "";

    // ── Cache result ──────────────────────────────────────────────────────
    await admin
      .from("recommendation_narratives")
      .upsert({
        org_id:       orgId,
        rec_key:      rec.id,
        narrative:    text,
        stats_hash:   hash,
        generated_at: new Date().toISOString(),
      }, { onConflict: "org_id,rec_key" });

    return text;
  } catch {
    return "";
  }
}

/**
 * Batch-generate narratives for multiple recommendations.
 * Runs concurrently (max 3 parallel calls) to respect rate limits.
 */
export async function batchGetNarratives(
  orgId: string,
  recs:  Recommendation[],
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  const CONCURRENCY = 3;

  for (let i = 0; i < recs.length; i += CONCURRENCY) {
    const batch = recs.slice(i, i + CONCURRENCY);
    const texts = await Promise.all(batch.map(r => getNarrative(orgId, r)));
    batch.forEach((r, j) => { results[r.id] = texts[j] ?? ""; });
  }

  return results;
}
