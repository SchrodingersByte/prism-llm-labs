/**
 * Outcome rule processor.
 *
 * Called from webhook handlers (GitHub, Stripe, generic) to automatically
 * emit outcome_events based on configured org-level rules.
 * This makes unit economics tracking passive — no SDK call required.
 */
import { createClient } from "@supabase/supabase-js";
import { v4 as uuidv4 } from "uuid";
import { ingestToTinybird } from "@/lib/tinybird/client";

export type OutcomeSource =
  | "github_pr_merge"
  | "github_deployment_success"
  | "stripe_payment"
  | "generic_webhook"
  | "mcp_session_success";

interface OutcomeRule {
  id:          string;
  feature_tag: string;
  action_tag:  string | null;
  value_usd:   number | null;
  success:     boolean;
}

// Cache rules per (orgId, eventSource) for 60 s
const ruleCache = new Map<string, { rules: OutcomeRule[]; expiresAt: number }>();

async function loadRules(orgId: string, eventSource: OutcomeSource): Promise<OutcomeRule[]> {
  const cacheKey = `${orgId}:${eventSource}`;
  const hit = ruleCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.rules;

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("outcome_rules")
    .select("id, feature_tag, action_tag, value_usd, success")
    .eq("org_id", orgId)
    .eq("event_source", eventSource)
    .eq("is_active", true) as { data: OutcomeRule[] | null };

  const rules = data ?? [];
  ruleCache.set(cacheKey, { rules, expiresAt: Date.now() + 60_000 });
  return rules;
}

/**
 * Process outcome rules for an incoming event.
 * For each active rule matching (orgId, eventSource), emits an outcome_event.
 *
 * @param eventSource - the type of event that triggered this
 * @param payload     - the raw webhook payload (used to extract session_id if available)
 * @param orgId       - the Prism org to scope rules to
 */
export async function processOutcomeRules(
  eventSource: OutcomeSource,
  payload:     Record<string, unknown>,
  orgId:       string,
): Promise<void> {
  try {
    const rules = await loadRules(orgId, eventSource);
    if (!rules.length) return;

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    // Try to extract a session_id from the payload (e.g., commit SHA matching git_commit tag)
    const sessionId = extractSessionId(eventSource, payload);
    const now = new Date().toISOString();

    const dbRows = rules.map(rule => ({
      org_id:      orgId,
      feature_tag: rule.feature_tag,
      action_tag:  rule.action_tag  ?? null,
      session_id:  sessionId        ?? null,
      success:     rule.success,
      value_usd:   rule.value_usd   ?? null,
      metadata:    { source: eventSource, payload_keys: Object.keys(payload).slice(0, 10) },
      occurred_at: now,
    }));

    // Write to Supabase + Tinybird in parallel
    await Promise.all([
      (admin as any).from("outcome_events").insert(dbRows),  // eslint-disable-line @typescript-eslint/no-explicit-any
      ingestToTinybird(
        rules.map((rule, i) => ({
          event_id:    uuidv4(),
          org_id:      orgId,
          feature_tag: rule.feature_tag,
          action_tag:  rule.action_tag  ?? "",
          session_id:  sessionId        ?? "",
          success:     rule.success ? 1 : 0,
          value_usd:   rule.value_usd   ?? 0,
          occurred_at: now,
        })),
        "outcome_events",
      ),
    ]);
  } catch (err) {
    // Never let outcome recording break webhooks
    console.warn("[outcomes/rules] Failed to process rules:", err);
  }
}

function extractSessionId(
  source:  OutcomeSource,
  payload: Record<string, unknown>,
): string | null {
  switch (source) {
    case "github_pr_merge":
    case "github_deployment_success": {
      // Commit SHA can be correlated with git_commit tag on LLM events
      const pr  = payload.pull_request as Record<string, unknown> | undefined;
      const dep = payload.deployment   as Record<string, unknown> | undefined;
      const sha = ((pr?.head as Record<string, unknown> | undefined)?.sha as string | undefined)
               ?? (dep?.sha as string | undefined)
               ?? null;
      return sha ? String(sha).slice(0, 7) : null;
    }
    case "stripe_payment":
      return (payload.client_reference_id as string | undefined) ?? null;
    case "generic_webhook":
      return (payload.session_id as string | undefined)
          ?? (payload.prism_session_id as string | undefined)
          ?? null;
    default:
      return null;
  }
}
