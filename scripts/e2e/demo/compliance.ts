/**
 * Phase 4 — PII incidents + Enforce/Shadow IT seed.
 * Inserts pii_incidents, enforce_checkins, sdk_bypass_events.
 */

import { createClient } from "@supabase/supabase-js";
import type { DemoContext } from "./infra";

const SUPABASE_URL         = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) as any;

function daysAgo(n: number, hour = 10): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

export async function seedCompliance(ctx: DemoContext) {
  const { orgId, userId, apiKeys } = ctx;
  const devKeyId = apiKeys.devUnrestricted.id;

  // ── PII incidents ─────────────────────────────────────────────────────────
  const piiIncidents = [
    // 3 email detections — customer-support feature
    { provider: "openai",    model: "gpt-4o-mini",             pii_types: ["email"],       action_taken: "warn", field_paths: ["messages[1].content"], api_key_id: apiKeys.prodAll.id,     daysAgo: 2  },
    { provider: "openai",    model: "gpt-4o",                  pii_types: ["email"],       action_taken: "warn", field_paths: ["messages[0].content"], api_key_id: apiKeys.prodAll.id,     daysAgo: 5  },
    { provider: "anthropic", model: "claude-3-5-haiku-20241022",pii_types: ["email"],      action_taken: "warn", field_paths: ["messages[0].content"], api_key_id: apiKeys.prodAnthropic.id, daysAgo: 8 },
    // 2 phone detections — code-review feature
    { provider: "openai",    model: "gpt-4o",                  pii_types: ["phone"],       action_taken: "warn", field_paths: ["messages[2].content"], api_key_id: apiKeys.prodAll.id,     daysAgo: 3  },
    { provider: "openai",    model: "gpt-4o-mini",             pii_types: ["phone"],       action_taken: "warn", field_paths: ["messages[1].content"], api_key_id: apiKeys.devUnrestricted.id, daysAgo: 12 },
    // 2 SSN detections — document-analysis feature
    { provider: "anthropic", model: "claude-3-5-sonnet-20241022", pii_types: ["ssn"],      action_taken: "warn", field_paths: ["messages[0].content", "messages[1].content"], api_key_id: apiKeys.prodAnthropic.id, daysAgo: 6 },
    { provider: "openai",    model: "gpt-4o-mini",             pii_types: ["ssn"],         action_taken: "warn", field_paths: ["messages[0].content"], api_key_id: apiKeys.prodAll.id,     daysAgo: 14 },
    // 1 credit_card detection — customer-support
    { provider: "openai",    model: "gpt-4o",                  pii_types: ["credit_card"], action_taken: "warn", field_paths: ["messages[3].content"], api_key_id: apiKeys.prodAll.id,     daysAgo: 1  },
  ];

  for (const inc of piiIncidents) {
    const { daysAgo: n, ...row } = inc;
    // pii_incidents has no unique constraint — insert with created_at spread across days
    await admin.from("pii_incidents").insert({
      org_id:      orgId,
      user_id:     userId,
      created_at:  daysAgo(n, 9 + Math.floor(Math.random() * 8)),
      ...row,
    });
  }
  console.log(`[compliance] ${piiIncidents.length} PII incidents inserted`);

  // ── Enforce checkins ──────────────────────────────────────────────────────
  const services = [
    { service_name: "analytics-api",   app_version: "2.3.1", enforce_mode: "transparent", language: "node",   bypass_count: 0,  first_seen: 30 },
    { service_name: "data-pipeline",   app_version: "1.8.4", enforce_mode: "warn",        language: "python", bypass_count: 12, first_seen: 25 },
    { service_name: "ml-training",     app_version: "0.9.2", enforce_mode: "warn",        language: "python", bypass_count: 3,  first_seen: 20 },
    { service_name: "legacy-backend",  app_version: "3.1.0", enforce_mode: "strict",      language: "node",   bypass_count: 0,  first_seen: 60 },
  ];

  for (const svc of services) {
    await admin.from("enforce_checkins").upsert(
      {
        org_id:       orgId,
        service_name: svc.service_name,
        app_version:  svc.app_version,
        enforce_mode: svc.enforce_mode,
        language:     svc.language,
        first_seen_at: daysAgo(svc.first_seen),
        last_seen_at:  daysAgo(0),
        bypass_count:  svc.bypass_count,
      },
      { onConflict: "org_id,service_name", ignoreDuplicates: false },
    );
  }
  console.log("[compliance] enforce_checkins upserted");

  // ── Bypass events ─────────────────────────────────────────────────────────
  const dataPipelineModules = [
    "openai", "anthropic", "langchain", "litellm", "openai", "anthropic",
    "openai", "litellm", "openai", "anthropic", "openai", "langchain",
  ];
  const mlModules = ["openai", "anthropic", "transformers"];

  for (let i = 0; i < 12; i++) {
    await admin.from("sdk_bypass_events").insert({
      org_id:              orgId,
      key_id:              devKeyId,
      raw_module:          dataPipelineModules[i],
      environment:         "production",
      git_branch:          i < 6 ? "main" : "feature/batch-processor",
      git_commit:          `abc${i.toString().padStart(4, "0")}def`,
      app_name:            "data-pipeline",
      key_name:            "dev-unrestricted",
      assigned_user_email: "bob@company.com",
      occurred_at:         daysAgo(Math.floor(i * 1.5), 8 + (i % 8)),
    });
  }

  for (let i = 0; i < 3; i++) {
    await admin.from("sdk_bypass_events").insert({
      org_id:              orgId,
      key_id:              devKeyId,
      raw_module:          mlModules[i],
      environment:         "development",
      git_branch:          "experiment/llm-eval",
      git_commit:          `ef${i.toString().padStart(6, "0")}`,
      app_name:            "ml-training",
      key_name:            "dev-unrestricted",
      assigned_user_email: "bob@company.com",
      occurred_at:         daysAgo(20 - i * 3, 14),
    });
  }
  console.log("[compliance] sdk_bypass_events inserted (15 rows)");
}
