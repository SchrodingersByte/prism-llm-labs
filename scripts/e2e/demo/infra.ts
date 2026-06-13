/**
 * Phase 1 — Supabase infrastructure seed for the real user org.
 * All inserts are idempotent (find-or-create / upsert on conflict columns).
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash, createCipheriv } from "crypto";

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY      = process.env.OPENAI_API_KEY ?? "sk-stub-openai";
const ANTHROPIC_API_KEY   = process.env.ANTHROPIC_API_KEY ?? "";
const GOOGLE_API_KEY      = process.env.GOOGLE_API_KEY ?? "";
const ENCRYPTION_SECRET   = process.env.ENCRYPTION_SECRET!;
const USER_EMAIL          = "dip.dey2112@gmail.com";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) as any;

function encryptKey(plaintext: string): string {
  const secret    = Buffer.from(ENCRYPTION_SECRET, "hex");
  const iv        = randomBytes(16);
  const cipher    = createCipheriv("aes-256-cbc", secret, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

function makeApiKey(orgId: string, env: "live" | "test"): {
  rawKey: string; keyHash: string; keyPrefix: string; keySuffix: string;
} {
  const orgPrefix = orgId.replace(/-/g, "").slice(0, 4);
  const rawKey    = `prism_${env}_${orgPrefix}_${randomBytes(24).toString("hex")}`;
  const keyHash   = createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 12);
  const keySuffix = rawKey.slice(-4);
  return { rawKey, keyHash, keyPrefix, keySuffix };
}

async function findOrCreate<T>(
  table: string,
  matchCols: Record<string, unknown>,
  insertData: Record<string, unknown>,
  selectFields = "id",
): Promise<string> {
  const query = Object.entries(matchCols).reduce(
    (q, [k, v]) => q.eq(k, v),
    admin.from(table).select(selectFields),
  );
  const { data: existing } = await query.maybeSingle();
  if (existing) return existing.id as string;
  const { data: created, error } = await admin.from(table).insert(insertData).select(selectFields).single();
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
  return created.id as string;
}

export interface DemoContext {
  orgId:    string;
  userId:   string;
  projects: { customerPlatform: string; dataAnalytics: string; developerTools: string; mlResearch: string };
  apiKeys:  {
    prodAll:         { id: string; rawKey: string };
    prodMiniOnly:    { id: string; rawKey: string };
    prodAnthropic:   { id: string; rawKey: string };
    devUnrestricted: { id: string; rawKey: string };
    stagingControlled:{ id: string; rawKey: string };
  };
  teams:         { aiEng: string; dataSci: string; devEx: string };
  providerKeys:  { openaiUnrestricted: string; miniOnly: string; anthropic?: string; google?: string; openaiEu: string; ollama: string };
}

export async function seedInfra(): Promise<DemoContext> {
  // ── 1. Resolve user + org ─────────────────────────────────────────────────
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = users.find((u: { email?: string }) => u.email === USER_EMAIL);
  if (!user) throw new Error(`User ${USER_EMAIL} not found in auth`);
  const userId = user.id as string;

  const { data: memberRow } = await admin.from("members").select("org_id").eq("user_id", userId).maybeSingle();
  if (!memberRow) throw new Error(`No membership found for ${USER_EMAIL}`);
  const orgId = memberRow.org_id as string;

  console.log(`[infra] org: ${orgId}  user: ${userId}`);

  // ── 2. Provider keys ──────────────────────────────────────────────────────
  async function upsertProviderKey(name: string, provider: string, keyPlain: string, opts: Record<string, unknown> = {}) {
    const { data: existing } = await admin.from("provider_keys").select("id").eq("org_id", orgId).eq("name", name).maybeSingle();
    if (existing) { console.log(`[infra] provider_key exists: ${name}`); return existing.id as string; }
    const { data, error } = await admin.from("provider_keys").insert({
      org_id:        orgId,
      provider,
      key_encrypted: encryptKey(keyPlain || "stub"),
      key_hint:      (keyPlain || "stub").slice(-4),
      name,
      is_active:     true,
      data_region:   "global",
      allowed_models: [],
      ...opts,
    }).select("id").single();
    if (error) throw new Error(`provider_keys[${name}]: ${error.message}`);
    console.log(`[infra] provider_key created: ${name}`);
    return data.id as string;
  }

  const pkOpenaiUnrestricted = await upsertProviderKey("prod-openai-unrestricted", "openai", OPENAI_API_KEY);
  const pkMiniOnly           = await upsertProviderKey("prod-openai-mini-only",    "openai", OPENAI_API_KEY, {
    allowed_models: ["gpt-4o-mini", "gpt-4.1-mini"],
  });
  let pkAnthropic: string | undefined;
  if (ANTHROPIC_API_KEY) {
    pkAnthropic = await upsertProviderKey("prod-anthropic", "anthropic", ANTHROPIC_API_KEY);
  } else {
    console.warn("[infra] ANTHROPIC_API_KEY not set — anthropic provider key stubbed");
    pkAnthropic = await upsertProviderKey("prod-anthropic", "anthropic", "sk-ant-stub-key-xxxx");
  }
  let pkGoogle: string | undefined;
  if (GOOGLE_API_KEY) {
    pkGoogle = await upsertProviderKey("prod-google", "google", GOOGLE_API_KEY);
  } else {
    console.warn("[infra] GOOGLE_API_KEY not set — google provider key stubbed");
    pkGoogle = await upsertProviderKey("prod-google", "google", "AIza-stub-key-xxxx");
  }
  const pkOpenaiEu = await upsertProviderKey("prod-openai-eu", "openai", OPENAI_API_KEY, { data_region: "eu" });
  const pkOllama   = await upsertProviderKey("local-ollama", "openai_compatible", "ollama-no-key", {
    custom_endpoint: "http://localhost:11434/v1",
  });

  const providerKeys = {
    openaiUnrestricted: pkOpenaiUnrestricted,
    miniOnly:           pkMiniOnly,
    anthropic:          pkAnthropic,
    google:             pkGoogle,
    openaiEu:           pkOpenaiEu,
    ollama:             pkOllama,
  };

  // ── 3. Prism API keys ─────────────────────────────────────────────────────
  async function upsertApiKey(
    name: string,
    environment: string,
    projectId: string | null,
    linkedProviderKeyId: string,
  ): Promise<{ id: string; rawKey: string }> {
    const { data: existing } = await admin.from("api_keys").select("id, key_prefix").eq("org_id", orgId).eq("name", name).maybeSingle();
    if (existing) {
      console.log(`[infra] api_key exists: ${name}`);
      // Return a placeholder rawKey — live mode won't need it, historical events skip auth
      return { id: existing.id as string, rawKey: `__existing_${existing.id}` };
    }
    const k = makeApiKey(orgId, "live");
    const { data, error } = await admin.from("api_keys").insert({
      org_id:      orgId,
      project_id:  projectId,
      user_id:     userId,
      key_hash:    k.keyHash,
      key_prefix:  k.keyPrefix,
      key_suffix:  k.keySuffix,
      name,
      environment,
      is_active:   true,
    }).select("id").single();
    if (error) throw new Error(`api_keys[${name}]: ${error.message}`);
    const keyId = data.id as string;
    // Link to provider key
    await admin.from("key_provider_links").upsert(
      { api_key_id: keyId, provider_key_id: linkedProviderKeyId },
      { onConflict: "api_key_id,provider_key_id", ignoreDuplicates: true },
    );
    console.log(`[infra] api_key created: ${name}`);
    return { id: keyId, rawKey: k.rawKey };
  }

  // Projects needed before keys (to assign project_id to a key)
  // Insert projects now for projectId references, even though 1d is "after" 1c in the plan
  async function upsertProject(name: string, slug: string, costCenter: string): Promise<string> {
    const { data: existing } = await admin.from("projects").select("id").eq("org_id", orgId).eq("slug", slug).maybeSingle();
    if (existing) { console.log(`[infra] project exists: ${slug}`); return existing.id as string; }
    const { data, error } = await admin.from("projects").insert({ org_id: orgId, name, slug, cost_center_code: costCenter }).select("id").single();
    if (error) throw new Error(`projects[${slug}]: ${error.message}`);
    console.log(`[infra] project created: ${slug}`);
    return data.id as string;
  }

  const projCustomer  = await upsertProject("Customer Platform",  "customer-platform", "GL-ENG-01");
  const projData      = await upsertProject("Data Analytics",     "data-analytics",    "GL-DATA-02");
  const projDev       = await upsertProject("Developer Tools",    "developer-tools",   "GL-DEV-03");
  const projMl        = await upsertProject("ML Research",        "ml-research",       "GL-ML-04");

  const projects = { customerPlatform: projCustomer, dataAnalytics: projData, developerTools: projDev, mlResearch: projMl };

  const keyProdAll     = await upsertApiKey("prod-all-models",        "production",  projCustomer, pkOpenaiUnrestricted);
  const keyMiniOnly    = await upsertApiKey("prod-gpt-mini-only",     "production",  projCustomer, pkMiniOnly);
  const keyAnthropic   = await upsertApiKey("prod-anthropic-only",    "production",  projData,     pkAnthropic!);
  const keyDev         = await upsertApiKey("dev-unrestricted",       "development", projDev,      pkOpenaiUnrestricted);
  const keyStaging     = await upsertApiKey("staging-cost-controlled", "staging",    projMl,       pkOpenaiUnrestricted);

  const apiKeys = {
    prodAll:          keyProdAll,
    prodMiniOnly:     keyMiniOnly,
    prodAnthropic:    keyAnthropic,
    devUnrestricted:  keyDev,
    stagingControlled: keyStaging,
  };

  // ── 4. Key caps ───────────────────────────────────────────────────────────
  async function upsertCap(apiKeyId: string, period: string, amount: number, isRolling = false) {
    await admin.from("key_caps").upsert(
      { api_key_id: apiKeyId, org_id: orgId, period, is_rolling: isRolling, amount_usd: amount },
      { onConflict: "api_key_id,period,is_rolling", ignoreDuplicates: false },
    );
  }
  await upsertCap(keyMiniOnly.id,    "monthly",  50);
  await upsertCap(keyAnthropic.id,   "monthly",  100);
  await upsertCap(keyDev.id,         "daily",    5);
  await upsertCap(keyStaging.id,     "weekly",   10);
  console.log("[infra] key_caps upserted");

  // ── 5. Budgets ────────────────────────────────────────────────────────────
  async function upsertBudget(projectId: string, amount: number, hardCap = false) {
    await admin.from("budgets").upsert(
      { org_id: orgId, project_id: projectId, period: "monthly", amount_usd: amount, alert_pct: 80, enforce_hard_cap: hardCap },
      { onConflict: "org_id,project_id,period", ignoreDuplicates: false },
    );
  }
  await upsertBudget(projCustomer, 200);
  await upsertBudget(projData,     150);
  await upsertBudget(projDev,      100);
  await upsertBudget(projMl,       300, true);
  console.log("[infra] budgets upserted");

  // ── 6. Teams ──────────────────────────────────────────────────────────────
  async function upsertTeam(name: string, description: string): Promise<string> {
    const { data: existing } = await admin.from("teams").select("id").eq("org_id", orgId).eq("name", name).maybeSingle();
    if (existing) { console.log(`[infra] team exists: ${name}`); return existing.id as string; }
    const { data, error } = await admin.from("teams").insert({ org_id: orgId, name, description, created_by: userId }).select("id").single();
    if (error) throw new Error(`teams[${name}]: ${error.message}`);
    console.log(`[infra] team created: ${name}`);
    return data.id as string;
  }

  const teamAiEng  = await upsertTeam("AI Engineering",       "Builds customer-facing AI features");
  const teamData   = await upsertTeam("Data Science",          "Analytics and model training");
  const teamDevEx  = await upsertTeam("Developer Experience",  "Internal tooling and DX");

  for (const teamId of [teamAiEng, teamData, teamDevEx]) {
    await admin.from("team_members").upsert(
      { team_id: teamId, user_id: userId, added_by: userId },
      { onConflict: "team_id,user_id", ignoreDuplicates: true },
    );
  }
  console.log("[infra] teams + members upserted");

  const teams = { aiEng: teamAiEng, dataSci: teamData, devEx: teamDevEx };

  // ── 7. Model routing rules ────────────────────────────────────────────────
  async function upsertRoutingRule(primaryModel: string, candidates: Array<{ model: string; provider: string }>, apiKeyId?: string) {
    // No unique constraint on the table — find or insert
    let query = admin.from("model_routing_rules").select("id").eq("org_id", orgId).eq("primary_model", primaryModel);
    if (apiKeyId) query = query.eq("api_key_id", apiKeyId);
    else          query = query.is("api_key_id", null);
    const { data: existing } = await query.maybeSingle();

    const row: Record<string, unknown> = {
      org_id:              orgId,
      primary_model:       primaryModel,
      fallback_candidates: candidates,
      trigger_on_codes:    [429, 503, 500, 502],
      is_active:           true,
    };
    if (apiKeyId) row.api_key_id = apiKeyId;

    if (existing) {
      await admin.from("model_routing_rules").update({ fallback_candidates: candidates, is_active: true }).eq("id", existing.id);
      console.log(`[infra] routing rule updated: ${primaryModel}${apiKeyId ? " (key-scoped)" : ""}`);
    } else {
      const { error } = await admin.from("model_routing_rules").insert(row);
      if (error) console.warn(`[infra] routing rule warn [${primaryModel}]: ${error.message}`);
      else console.log(`[infra] routing rule created: ${primaryModel}${apiKeyId ? " (key-scoped)" : ""}`);
    }
  }

  await upsertRoutingRule("gpt-4o", [
    { model: "gpt-4o-mini",              provider: "openai" },
    { model: "claude-3-5-haiku-20241022", provider: "anthropic" },
  ]);
  await upsertRoutingRule("claude-3-5-sonnet-20241022", [
    { model: "claude-3-5-haiku-20241022", provider: "anthropic" },
    { model: "gpt-4o-mini",              provider: "openai" },
  ]);
  await upsertRoutingRule("gemini-2.0-flash", [
    { model: "gpt-4o-mini", provider: "openai" },
  ]);
  await upsertRoutingRule("gpt-4o-mini", [
    { model: "gemini-2.0-flash", provider: "google" },
  ], keyMiniOnly.id);

  // ── 8. Action definitions ─────────────────────────────────────────────────
  const actionDefs = [
    { name: "Support Ticket Resolution", feature_tag: "customer-support",   calls_per_action: 3,  description: "Full resolution of one customer support ticket" },
    { name: "Document Processing Job",   feature_tag: "document-analysis",  calls_per_action: 2,  description: "Extract and summarise one PDF or document" },
    { name: "Code Review Pass",          feature_tag: "code-review",        calls_per_action: 4,  description: "One complete automated code review cycle" },
    { name: "Product Recommendation",   feature_tag: "recommendations",    calls_per_action: 1,  description: "Single item recommendation served to a user" },
    { name: "Semantic Search Query",     feature_tag: "search",             calls_per_action: 1,  description: "One semantic search request" },
    { name: "Image Analysis Job",        feature_tag: "image-analysis",     calls_per_action: 1,  description: "One image OCR or analysis task" },
  ];

  for (const def of actionDefs) {
    await admin.from("action_definitions").upsert(
      { org_id: orgId, ...def },
      { onConflict: "org_id,feature_tag", ignoreDuplicates: false },
    );
  }
  console.log("[infra] action_definitions upserted");

  // ── 9. PII configuration ──────────────────────────────────────────────────
  await admin.from("organizations").update({
    pii_masking_enabled:    true,
    pii_mask_patterns:      ["email", "phone", "ssn", "credit_card", "ip_address"],
    pii_detection_enabled:  true,
    pii_detection_action:   "warn",
  }).eq("id", orgId);
  console.log("[infra] PII config updated");

  return { orgId, userId, projects, apiKeys, teams, providerKeys };
}
