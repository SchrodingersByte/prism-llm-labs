import { SupabaseClient } from "@supabase/supabase-js";

// In-process cache (60s TTL — policies change infrequently).
// Keyed by org+model+environment so each resolved decision is memoised
// independently (one DB read per distinct request shape per 60s).
const _policyCache = new Map<string, { result: PolicyResult; ts: number }>();
const POLICY_TTL_MS = 60_000;

interface PolicyRow {
  id:            string;
  model_pattern: string;
  environments:  string[] | null;
  policy:        "allowed" | "blocked" | "requires_approval";
}

export interface PolicyResult {
  allowed:          boolean;
  requiresApproval: boolean;
  reason?:          string;
}

/**
 * Checks the org-level model governance policy for a given model request.
 *
 * Evaluates `org_model_policies` (org-level rules that sit above per-key
 * provider allowlists). The first rule whose `model_pattern` matches the model
 * (exact or glob prefix) and whose `environments` includes the request
 * environment (null = all environments) decides the outcome:
 *
 * - allowed / no matching rule → allow
 * - blocked                    → deny
 * - requires_approval          → deny, unless an approved row exists in
 *                                `model_approval_requests` for this org + model
 *                                (a temporary exception)
 *
 * Cached per org+model+environment for 60 s.
 */
export async function checkOrgModelPolicy(
  supabase:     SupabaseClient,
  orgId:        string,
  model:        string,
  _environment: string,
  _apiKeyId:    string,
): Promise<PolicyResult> {
  const cacheKey = `omp:${orgId}:${model}:${_environment}`;
  const cached   = _policyCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < POLICY_TTL_MS) {
    return cached.result;
  }

  const result = await resolvePolicy(supabase, orgId, model, _environment);
  _policyCache.set(cacheKey, { result, ts: Date.now() });
  return result;
}

async function resolvePolicy(
  supabase:    SupabaseClient,
  orgId:       string,
  model:       string,
  environment: string,
): Promise<PolicyResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from("org_model_policies")
    .select("id, model_pattern, environments, policy")
    .eq("org_id", orgId) as { data: PolicyRow[] | null };

  const policies = data ?? [];

  // First rule that matches the model AND applies to this environment.
  const rule = policies.find(
    p =>
      matchesModel(p.model_pattern, model) &&
      (!p.environments || p.environments.includes(environment)),
  );

  if (!rule || rule.policy === "allowed") {
    return { allowed: true, requiresApproval: false };
  }

  if (rule.policy === "blocked") {
    return {
      allowed:          false,
      requiresApproval: false,
      reason:           `Model "${model}" is blocked by org policy. Contact your admin.`,
    };
  }

  // requires_approval — allow only if an approved exception exists for org + model.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: approval } = await (supabase as any)
    .from("model_approval_requests")
    .select("id")
    .eq("org_id", orgId)
    .eq("model", model)
    .eq("status", "approved")
    .maybeSingle() as { data: { id: string } | null };

  if (approval) {
    return { allowed: true, requiresApproval: false };
  }

  return {
    allowed:          false,
    requiresApproval: true,
    reason:           `Model "${model}" requires approval before use. Request access in your dashboard.`,
  };
}

function matchesModel(pattern: string, model: string): boolean {
  if (pattern.endsWith("*")) return model.startsWith(pattern.slice(0, -1));
  return pattern === model;
}
