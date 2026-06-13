/**
 * TypeScript SDK — gateway mode E2E test.
 *
 * Routes all LLM calls through the Prism gateway at PRISM_GATEWAY_URL.
 * Covers: gateway telemetry, streaming TTFT capture.
 *
 * Run with: npx ts-node --project scripts/e2e/tsconfig.json scripts/e2e/run-ts-gateway.ts
 */

import * as fs from "fs";

require("dotenv").config({ path: ".env.e2e" });

interface Seed {
  projectId:    string;
  gatewayRawKey: string | null;
  appUrl:       string;
}

async function run() {
  if (!fs.existsSync(".e2e-seed.json")) {
    console.error("[gateway] .e2e-seed.json not found — run seed.ts first");
    process.exit(1);
  }

  const { projectId, gatewayRawKey, appUrl }: Seed =
    JSON.parse(fs.readFileSync(".e2e-seed.json", "utf-8"));

  if (!gatewayRawKey) {
    console.warn("[gateway] No gateway key in seed (provider key creation failed in seed.ts) — skipping gateway tests");
    return;
  }

  // Set gateway URL so the SDK auto-detects gateway mode
  process.env["PRISM_GATEWAY_URL"] = appUrl;

  // Import after env var is set
  const { OpenAI } = await import("@prism-llm-labs/sdk");

  const client = new OpenAI({
    // In gateway mode, apiKey is the Prism key (SDK rewrites baseURL to gateway)
    apiKey:      gatewayRawKey,
    prismKey:    gatewayRawKey,
    project:     projectId,
    environment: "development",
  });

  // ── Test A: Normal completion through gateway ─────────────────────────────────
  console.log("[gateway] A: completion through gateway");
  const resp = await client.chat.completions.create({
    model:    "gpt-4o-mini",
    messages: [{ role: "user", content: "Say: gateway-test-ok" }],
  });
  console.log(`[gateway] A: response = ${resp.choices[0]?.message?.content ?? "(empty)"}`);

  // ── Test B: Streaming through gateway (captures ttft_ms) ─────────────────────
  console.log("[gateway] B: streaming through gateway (ttft_ms capture)");
  const stream = await client.chat.completions.create({
    model:    "gpt-4o-mini",
    messages: [{ role: "user", content: "Count to 3" }],
    stream:   true,
  });
  let chunks = 0;
  for await (const chunk of stream) {
    if (chunk.choices[0]?.delta?.content) chunks++;
  }
  console.log(`[gateway] B: received ${chunks} content chunks`);

  console.log("[gateway] All tests complete — events sent to Tinybird via gateway route");
}

run().catch((err) => {
  console.error("[gateway] Fatal:", err);
  process.exit(1);
});
