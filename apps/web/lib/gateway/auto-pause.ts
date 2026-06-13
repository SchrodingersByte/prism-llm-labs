/**
 * auto-pause.ts — Idempotent API key auto-pause helper.
 *
 * Called fire-and-forget when a hard spend cap is exceeded. Sets
 * `auto_paused_at` on the `api_keys` row so subsequent gateway/ingest
 * requests fail fast with 403 (skipping expensive cap re-evaluation).
 *
 * Cleared by an admin calling PATCH /api/admin/keys/{id} with
 * { auto_paused_at: null, auto_pause_reason: null }.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Mark a key as auto-paused. Only sets the columns if the key is not
 * already paused — making this fully idempotent under concurrent requests.
 */
export async function autoPauseKey(
  supabase: SupabaseClient,
  apiKeyId: string,
  reason: "hard_cap_exceeded" | "circuit_open_sustained" | "admin_pause",
): Promise<void> {
  try {
    await supabase
      .from("api_keys")
      .update({
        auto_paused_at:    new Date().toISOString(),
        auto_pause_reason: reason,
      })
      .eq("id", apiKeyId)
      .is("auto_paused_at", null); // idempotent: skip if already paused
  } catch {
    // Never propagate — this is always called fire-and-forget
  }
}

/**
 * Clear an auto-pause, re-activating the key.
 * Called from the admin unblock endpoint.
 */
export async function clearAutoPause(
  supabase: SupabaseClient,
  apiKeyId: string,
): Promise<void> {
  await supabase
    .from("api_keys")
    .update({
      auto_paused_at:    null,
      auto_pause_reason: null,
    })
    .eq("id", apiKeyId);
}
