/**
 * Supabase mock helpers for unit/integration tests.
 * Provides a fluent chain mock that matches the real Supabase client API.
 */
import { vi } from "vitest";

export type MockChain = Record<string, unknown>;

/** Build a fully-chainable Supabase query builder mock. */
export function makeChain(data: unknown = null, error: unknown = null): MockChain {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select      = vi.fn(self);
  chain.eq          = vi.fn(self);
  chain.neq         = vi.fn(self);
  chain.not         = vi.fn(self);
  chain.gte         = vi.fn(self);
  chain.lte         = vi.fn(self);
  chain.gt          = vi.fn(self);
  chain.lt          = vi.fn(self);
  chain.in          = vi.fn(self);
  chain.is          = vi.fn(self);
  chain.limit       = vi.fn(self);
  chain.order       = vi.fn(self);
  chain.range       = vi.fn(self);
  chain.filter      = vi.fn(self);
  chain.update      = vi.fn(self);
  chain.delete      = vi.fn(self);
  chain.upsert      = vi.fn().mockResolvedValue({ data, error });
  chain.insert      = vi.fn().mockResolvedValue({ data, error });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  chain.single      = vi.fn().mockResolvedValue({ data, error });
  chain.then        = undefined; // prevent being treated as thenable
  return chain;
}

/** Create a mock `from()` dispatcher that routes table names to specific data. */
export function makeFromDispatcher(
  tableMap: Record<string, unknown>,
  defaultData: unknown = null,
) {
  return vi.fn((table: string) => {
    const data = table in tableMap ? tableMap[table] : defaultData;
    return makeChain(data);
  });
}

// ── Standard fixture data ─────────────────────────────────────────────────────

export const TEST_ORG_A = {
  id:   "org-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  name: "Org Alpha",
  plan: "growth",
  data_residency_policy: "any",
  gateway_mode:          "sdk_optional",
  pii_masking_enabled:   false,
  pii_mask_patterns:     ["email", "phone", "ssn", "credit_card", "ip_address"],
  cache_enabled:         false,
  cache_ttl_seconds:     3600,
};

export const TEST_ORG_B = {
  id:   "org-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  name: "Org Beta",
  plan: "starter",
  data_residency_policy: "any",
  gateway_mode:          "sdk_optional",
  pii_masking_enabled:   false,
  pii_mask_patterns:     [],
  cache_enabled:         false,
  cache_ttl_seconds:     3600,
};

export const TEST_USER_OWNER = {
  id:    "user-owner-001",
  email: "owner@test.com",
};

export const TEST_USER_MEMBER = {
  id:    "user-member-001",
  email: "member@test.com",
};

export const TEST_API_KEY = {
  id:               "key-00000000-0000-0000-0000-000000000001",
  org_id:           TEST_ORG_A.id,
  project_id:       null,
  user_id:          TEST_USER_OWNER.id,
  assigned_user_id: null,
  is_active:        true,
  expires_at:       null,
  cost_hard_cap_usd:  null,
  daily_cost_cap_usd: null,
  usage_buffer_pct:   0,
  key_prefix:       "prism_live_or",
  key_suffix:       "abc1",
  prompt_logging_enabled: false,
  organizations:    { plan: "growth" },
};

export const TEST_PROVIDER_KEY_OPENAI = {
  id:              "pk-openai-001",
  org_id:          TEST_ORG_A.id,
  provider:        "openai",
  key_encrypted:   "iv:encrypted",
  allowed_models:  [],
  data_region:     "global",
  custom_endpoint: null,
  azure_endpoint:  null,
  is_active:       true,
};

/** Sample LLM event matching the Zod EventSchema */
export function sampleEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id:      "evt-test-001",
    timestamp:     new Date().toISOString().replace("T", " ").slice(0, 23),
    org_id:        TEST_ORG_A.id,
    project_id:    "",
    project_name:  "",
    team_id:       "",
    user_id:       "",
    environment:   "production",
    provider:      "openai",
    model:         "gpt-4o-mini",
    input_tokens:  100,
    output_tokens: 50,
    cached_tokens: 0,
    cost_usd:      0.000375,
    latency_ms:    450,
    ttft_ms:       0,
    status_code:   200,
    request_id:    "chatcmpl-test",
    tags:          {},
    image_tokens:  0,
    audio_tokens:  0,
    text_tokens:   0,
    modalities:    "text",
    ...overrides,
  };
}
