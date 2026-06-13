/**
 * E2E seed script — creates a fully-isolated test org in Supabase.
 *
 * Writes .e2e-seed.json with org/key/project IDs for use by subsequent phases.
 * Run with: npx ts-node --project scripts/e2e/tsconfig.json scripts/e2e/seed.ts
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash, createCipheriv } from "crypto";
import * as fs from "fs";

// ── Load env ──────────────────────────────────────────────────────────────────
require("dotenv").config({ path: ".env.e2e" });

const SUPABASE_URL           = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const OPENAI_API_KEY         = process.env.OPENAI_API_KEY!;
const ENCRYPTION_SECRET      = process.env.ENCRYPTION_SECRET!;
const APP_URL                = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.e2e");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Encryption helper (mirrors apps/web/lib/crypto/keys.ts) ──────────────────
function encryptKey(plaintext: string): string {
  const secret    = Buffer.from(ENCRYPTION_SECRET, "hex");
  const iv        = randomBytes(16);
  const cipher    = createCipheriv("aes-256-cbc", secret, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

// ── Key generation (mirrors apps/web/app/api/keys/route.ts) ──────────────────
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

async function run() {
  const tag = `e2e-${Date.now()}`;
  console.log(`[seed] Creating test org: ${tag}`);

  // ── 1. Create org ────────────────────────────────────────────────────────────
  const orgId = crypto.randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: orgErr } = await (admin as any).from("organizations").insert({
    id:   orgId,
    name: `e2e-test-${tag}`,
    slug: `e2e-test-${tag}`,
    plan: "startup",
  });
  if (orgErr) { console.error("org insert failed:", orgErr); process.exit(1); }
  console.log(`[seed] org: ${orgId}`);

  // ── 2. Create test user ──────────────────────────────────────────────────────
  const email    = `${tag}@prism-e2e.internal`;
  const password = randomBytes(16).toString("hex");
  const { data: authData, error: authErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authErr || !authData.user) { console.error("user create failed:", authErr); process.exit(1); }
  const userId = authData.user.id;
  console.log(`[seed] user: ${userId} (${email})`);

  // ── 3. Add user to org as owner (members table) ───────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: memberErr } = await (admin as any).from("members").insert({
    org_id:  orgId,
    user_id: userId,
    role:    "owner",
  });
  if (memberErr) { console.error("member insert failed:", memberErr); process.exit(1); }

  // ── 4. Create project ─────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: proj, error: projErr } = await (admin as any).from("projects").insert({
    org_id:            orgId,
    name:              "e2e-project",
    slug:              `e2e-project-${tag}`,
    cost_center_code:  "GL-E2E",
  }).select("id").single();
  if (projErr || !proj) { console.error("project insert failed:", projErr); process.exit(1); }
  const projectId = proj.id as string;
  console.log(`[seed] project: ${projectId}`);

  // ── 5. Create analytics Prism API key ────────────────────────────────────────
  const analyticsKey = makeApiKey(orgId, "test");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: akRow, error: akErr } = await (admin as any).from("api_keys").insert({
    org_id:      orgId,
    project_id:  projectId,
    user_id:     userId,
    key_hash:    analyticsKey.keyHash,
    key_prefix:  analyticsKey.keyPrefix,
    key_suffix:  analyticsKey.keySuffix,
    name:        "e2e-analytics-key",
    environment: "development",
    is_active:   true,
  }).select("id").single();
  if (akErr || !akRow) { console.error("analytics key insert failed:", akErr); process.exit(1); }
  const analyticsKeyId = akRow.id as string;
  console.log(`[seed] analytics key: ${analyticsKey.rawKey.slice(0, 20)}...`);

  // ── 6. Create provider key (encrypted OpenAI key for gateway mode) ────────────
  let providerKeyId: string | null = null;
  let gatewayRawKey: string | null = null;

  if (OPENAI_API_KEY && ENCRYPTION_SECRET) {
    const keyEncrypted = encryptKey(OPENAI_API_KEY);
    const keyHint      = OPENAI_API_KEY.slice(-4);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pkRow, error: pkErr } = await (admin as any).from("provider_keys").insert({
      org_id:        orgId,
      provider:      "openai",
      key_encrypted: keyEncrypted,
      key_hint:      keyHint,
      name:          "e2e-openai",
      is_active:     true,
      data_region:   "global",
      allowed_models: [],
    }).select("id").single();
    if (pkErr || !pkRow) {
      console.warn("[seed] provider key insert failed (gateway tests will be skipped):", pkErr);
    } else {
      providerKeyId = pkRow.id as string;
      console.log(`[seed] provider key: ${providerKeyId}`);

      // Create gateway Prism key linked to the provider key
      const gwKey = makeApiKey(orgId, "test");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: gwRow, error: gwErr } = await (admin as any).from("api_keys").insert({
        org_id:          orgId,
        project_id:      projectId,
        provider_key_id: providerKeyId,
        user_id:         userId,
        key_hash:        gwKey.keyHash,
        key_prefix:      gwKey.keyPrefix,
        key_suffix:      gwKey.keySuffix,
        name:            "e2e-gateway-key",
        environment:     "development",
        is_active:       true,
      }).select("id").single();
      if (gwErr || !gwRow) {
        console.warn("[seed] gateway key insert failed:", gwErr);
      } else {
        const gwKeyId = gwRow.id as string;
        // Link gateway key to provider key via junction table
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any).from("key_provider_links").insert({
          api_key_id:      gwKeyId,
          provider_key_id: providerKeyId,
        });
        gatewayRawKey = gwKey.rawKey;
        console.log(`[seed] gateway key: ${gwKey.rawKey.slice(0, 20)}...`);
      }
    }
  } else {
    console.warn("[seed] OPENAI_API_KEY or ENCRYPTION_SECRET not set — gateway key skipped");
  }

  // ── 7. Create budget ──────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("budgets").insert({
    org_id:            orgId,
    period:            "monthly",
    amount_usd:        50,
    alert_pct:         80,
    enforce_hard_cap:  false,
  });

  // ── 8. Write seed output ──────────────────────────────────────────────────────
  const seed = {
    orgId,
    userId,
    projectId,
    analyticsKeyId,
    analyticsRawKey: analyticsKey.rawKey,
    providerKeyId,
    gatewayRawKey,
    appUrl: APP_URL,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(".e2e-seed.json", JSON.stringify(seed, null, 2));
  console.log("[seed] Done — .e2e-seed.json written");
  console.log(`[seed] orgId: ${orgId}`);
}

run().catch((err) => {
  console.error("[seed] Fatal:", err);
  process.exit(1);
});
