/**
 * Proactive routing policy engine.
 *
 * Evaluates a JSON-based condition DSL against request context and returns
 * a routing action (model/provider override) when a policy matches.
 *
 * Policies are loaded from Supabase and cached in Redis for 30 s (with a
 * 60 s in-memory fallback so Redis unavailability never blocks the gateway).
 *
 * Condition DSL:
 *   Leaf:  { field, op, value }   — resolved via dot-path on context
 *   AND:   { all: [...nodes] }
 *   OR:    { any: [...nodes] }
 *   NOT:   { not: node }
 *
 * Context fields:
 *   request.model, request.provider, request.environment
 *   request.tags.{key}
 *   provider.health.{provider}.error_rate   (0–1)
 *   provider.health.{provider}.latency_p50  (ms)
 *   org.plan
 */

import { redis } from "@/lib/upstash/redis";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FallbackCandidate } from "./routing";

// ── Types ────────────────────────────────────────────────────────────────────

export type ConditionOp = "eq" | "ne" | "gt" | "lt" | "gte" | "lte" | "startsWith" | "includes";

export type ConditionNode =
  | { field: string; op: ConditionOp; value: string | number | boolean }
  | { all: ConditionNode[] }
  | { any: ConditionNode[] }
  | { not: ConditionNode };

export interface PolicyAction {
  model:                string;
  provider:             string;
  fallback_candidates?: FallbackCandidate[];
  strategy?:            "error" | "latency" | "cost" | "health";
}

export interface PolicyContext {
  request: {
    model:       string;
    provider:    string;
    environment: string;
    tags:        Record<string, string>;
  };
  provider: {
    health: Record<string, { error_rate: number; latency_p50: number }>;
  };
  org: { plan: string };
}

interface StoredPolicy {
  id:        string;
  priority:  number;
  condition: ConditionNode;
  action:    PolicyAction;
  is_active: boolean;
}

// ── In-memory cache (60 s fallback when Redis is unavailable) ─────────────

const MEM_CACHE = new Map<string, { policies: StoredPolicy[]; expiresAt: number }>();
const MEM_TTL_MS = 60_000;
const REDIS_TTL_S = 30;

// ── Condition evaluation ─────────────────────────────────────────────────────

function resolvePath(ctx: PolicyContext, path: string): unknown {
  const parts = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let val: any = ctx;
  for (const p of parts) {
    if (val === null || val === undefined) return undefined;
    val = val[p];
  }
  return val;
}

export function evaluateCondition(node: ConditionNode, ctx: PolicyContext): boolean {
  if ("all" in node) return node.all.every(n => evaluateCondition(n, ctx));
  if ("any" in node) return node.any.some(n =>  evaluateCondition(n, ctx));
  if ("not" in node) return !evaluateCondition(node.not, ctx);

  const raw = resolvePath(ctx, node.field);
  const actual = raw ?? "";
  const { op, value } = node;

  switch (op) {
    case "eq":         return actual == value;                                            // intentional ==
    case "ne":         return actual != value;
    case "gt":         return Number(actual) > Number(value);
    case "lt":         return Number(actual) < Number(value);
    case "gte":        return Number(actual) >= Number(value);
    case "lte":        return Number(actual) <= Number(value);
    case "startsWith": return typeof actual === "string" && actual.startsWith(String(value));
    case "includes":   return typeof actual === "string" && actual.includes(String(value));
    default:           return false;
  }
}

// ── Validation (used at write-time to reject invalid DSL trees) ───────────────

export function validateCondition(node: unknown): node is ConditionNode {
  if (!node || typeof node !== "object") return false;
  const n = node as Record<string, unknown>;

  if ("all" in n) return Array.isArray(n.all) && n.all.every(validateCondition);
  if ("any" in n) return Array.isArray(n.any) && n.any.every(validateCondition);
  if ("not" in n) return validateCondition(n.not);

  if (typeof n.field !== "string" || !n.field) return false;
  const validOps: ConditionOp[] = ["eq","ne","gt","lt","gte","lte","startsWith","includes"];
  if (!validOps.includes(n.op as ConditionOp)) return false;
  const vt = typeof n.value;
  if (vt !== "string" && vt !== "number" && vt !== "boolean") return false;
  return true;
}

export function validateAction(action: unknown): action is PolicyAction {
  if (!action || typeof action !== "object") return false;
  const a = action as Record<string, unknown>;
  if (typeof a.model !== "string" || !a.model) return false;
  if (typeof a.provider !== "string" || !a.provider) return false;
  return true;
}

// ── Policy loading (Redis-backed with in-memory fallback) ─────────────────────

export async function loadOrgPolicies(
  orgId:   string,
  supabase: SupabaseClient,
): Promise<StoredPolicy[]> {
  const now = Date.now();

  // 1. In-memory hit
  const mem = MEM_CACHE.get(orgId);
  if (mem && mem.expiresAt > now) return mem.policies;

  // 2. Redis hit
  try {
    const cached = await redis.get<StoredPolicy[]>(`policies:${orgId}`);
    if (cached) {
      MEM_CACHE.set(orgId, { policies: cached, expiresAt: now + MEM_TTL_MS });
      return cached;
    }
  } catch { /* Redis unavailable — fall through */ }

  // 3. Supabase load
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("routing_policies")
      .select("id, priority, condition, action, is_active")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("priority", { ascending: true }) as { data: StoredPolicy[] | null };

    const policies = data ?? [];
    MEM_CACHE.set(orgId, { policies, expiresAt: now + MEM_TTL_MS });
    redis.set(`policies:${orgId}`, policies, { ex: REDIS_TTL_S }).catch(() => { /* non-blocking */ });
    return policies;
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Evaluate all active policies for the org, returning the first match's action.
 * Policies are pre-sorted by priority (lowest int = highest priority).
 * Returns null if no policy matches or on any error (always fails-open).
 */
export async function evaluatePolicies(
  orgId:   string,
  context: PolicyContext,
  supabase: SupabaseClient,
): Promise<PolicyAction | null> {
  try {
    const policies = await loadOrgPolicies(orgId, supabase);
    for (const p of policies) {
      if (!p.is_active) continue;
      if (evaluateCondition(p.condition, context)) {
        return p.action;
      }
    }
    return null;
  } catch {
    return null;  // always fails-open
  }
}

/** Invalidate the in-memory + Redis cache for an org (call on policy write). */
export async function invalidatePolicyCache(orgId: string): Promise<void> {
  MEM_CACHE.delete(orgId);
  await redis.del(`policies:${orgId}`).catch(() => { /* non-blocking */ });
}
