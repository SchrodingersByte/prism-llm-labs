/**
 * TypeScript SDK — analytics mode E2E test.
 *
 * Inserts data into Tinybird covering: Overview, Models, FinOps Vendors,
 * Cost Centers, Sessions, Branch analytics, Unit Economics.
 *
 * Run with: npx ts-node --project scripts/e2e/tsconfig.json scripts/e2e/run-ts-analytics.ts
 */

// Load env before any SDK imports
require("dotenv").config({ path: ".env.e2e" });
// Unset PRISM_GATEWAY_URL so analytics mode is used regardless of .env.e2e
delete process.env["PRISM_GATEWAY_URL"];

import * as fs from "fs";
import { OpenAI } from "@prism-llm-labs/sdk";

interface Seed {
  orgId:           string;
  projectId:       string;
  analyticsRawKey: string;
  appUrl:          string;
}

async function post(url: string, key: string, body: object): Promise<void> {
  const res = await fetch(url, {
    method:  "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn(`[analytics] POST ${url} → ${res.status}: ${text}`);
  }
}

async function run() {
  if (!fs.existsSync(".e2e-seed.json")) {
    console.error("[analytics] .e2e-seed.json not found — run seed.ts first");
    process.exit(1);
  }

  const { projectId, analyticsRawKey, appUrl }: Seed =
    JSON.parse(fs.readFileSync(".e2e-seed.json", "utf-8"));

  if (!process.env["OPENAI_API_KEY"]) {
    console.error("[analytics] OPENAI_API_KEY not set");
    process.exit(1);
  }

  const client = new OpenAI({
    apiKey:      process.env["OPENAI_API_KEY"],
    prismKey:    analyticsRawKey,
    project:     projectId,
    environment: "development",
  });

  // Helper: call create with optional x-prism-* headers
  // The patched SDK intercepts options.headers for tag extraction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const create = (body: object, opts?: object) =>
    (client.chat.completions.create as (...args: any[]) => Promise<any>)(body, opts);

  // ── Test A: Basic completion → Overview KPIs, Models breakdown ───────────────
  console.log("[analytics] A: basic completion (gpt-4o-mini)");
  await create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "Say: e2e-test-ok" }] });

  // ── Test B: Feature tag → Unit Economics features tab ─────────────────────────
  console.log("[analytics] B: feature tag (summarization)");
  await create(
    { model: "gpt-4o-mini", messages: [{ role: "user", content: "Summarize: the quick brown fox" }] },
    { headers: { "x-prism-feature": "summarization" } },
  );

  // ── Test C: Multi-call session → Sessions dashboard ──────────────────────────
  console.log("[analytics] C: session with 5 calls");
  const sessionId = crypto.randomUUID();
  const sessionClient = new OpenAI({
    apiKey:      process.env["OPENAI_API_KEY"],
    prismKey:    analyticsRawKey,
    project:     projectId,
    environment: "development",
    sessionId,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createSession = (body: object, opts?: object) =>
    (sessionClient.chat.completions.create as (...args: any[]) => Promise<any>)(body, opts);
  for (let i = 0; i < 5; i++) {
    await createSession({ model: "gpt-4o-mini", messages: [{ role: "user", content: `Session call ${i + 1}` }] });
  }

  // ── Test D: Cost center tag → FinOps Cost Centers tab ────────────────────────
  console.log("[analytics] D: cost center tag (GL-E2E)");
  await create(
    { model: "gpt-4o-mini", messages: [{ role: "user", content: "Cost center test" }] },
    { headers: { "x-prism-cost-center": "GL-E2E" } },
  );

  // ── Test E: Git branch tag via x-prism-tags → Branch analytics ───────────────
  console.log("[analytics] E: git branch (feature/e2e-test)");
  await create(
    { model: "gpt-4o-mini", messages: [{ role: "user", content: "Branch test" }] },
    { headers: { "x-prism-tags": JSON.stringify({ git_branch: "feature/e2e-test" }) } },
  );

  // ── Test F: Record outcome via REST → Unit Economics outcomes ─────────────────
  console.log("[analytics] F: outcome recording");
  await post(`${appUrl}/api/outcomes`, analyticsRawKey, {
    feature_tag: "summarization",
    success:     true,
    value_usd:   2.50,
    session_id:  sessionId,
  });

  // ── Test G: Synthetic error event → error rate metrics ───────────────────────
  // We inject a raw event with status_code 400 to populate error rate metrics
  // without triggering a real API error.
  console.log("[analytics] G: synthetic error event (status_code=400)");
  await post(`${appUrl}/api/ingest`, analyticsRawKey, {
    events: [{
      event_id:      crypto.randomUUID(),
      timestamp:     new Date().toISOString().replace("T", " ").slice(0, 23),
      org_id:        "",
      project_id:    projectId,
      project_name:  "e2e-project",
      team_id:       "",
      user_id:       "",
      environment:   "development",
      provider:      "openai",
      model:         "gpt-4o-mini",
      input_tokens:  10,
      output_tokens: 0,
      cached_tokens: 0,
      cost_usd:      0,
      latency_ms:    120,
      status_code:   400,
      request_id:    "e2e-simulated-error",
      tags:          { feature: "e2e-error-test" },
    }],
  });

  console.log("[analytics] All tests complete — events sent to Tinybird via /api/ingest");
  console.log(`[analytics] session_id for MCP linkage: ${sessionId}`);

  // Append sessionId to seed file for use by run-mcp.ts
  const seed = JSON.parse(fs.readFileSync(".e2e-seed.json", "utf-8"));
  seed.analyticsSessionId = sessionId;
  fs.writeFileSync(".e2e-seed.json", JSON.stringify(seed, null, 2));
}

run().catch((err) => {
  console.error("[analytics] Fatal:", err);
  process.exit(1);
});
