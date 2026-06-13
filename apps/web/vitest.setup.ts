import "@testing-library/jest-dom";
import { vi } from "vitest";

// ── Stub environment variables required by all tests ─────────────────────────
process.env.NEXT_PUBLIC_SUPABASE_URL      = "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY     = "test-service-role-key";
process.env.TINYBIRD_API_URL              = "https://api.tinybird.co";
process.env.TINYBIRD_INGEST_TOKEN         = "test-ingest-token";
process.env.TINYBIRD_ADMIN_TOKEN          = "test-admin-token";
process.env.UPSTASH_REDIS_REST_URL        = "https://test.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN      = "test-redis-token";
process.env.ENCRYPTION_SECRET            = "0".repeat(64); // 32-byte hex
process.env.CRON_SECRET                   = "test-cron-secret";
process.env.RESEND_API_KEY               = "re_test_key";
process.env.RESEND_FROM_EMAIL            = "noreply@test.com";
process.env.NEXT_PUBLIC_APP_URL          = "https://test.useprism.dev";
process.env.GITHUB_WEBHOOK_SECRET        = "test-github-secret";
process.env.SLACK_SIGNING_SECRET         = "test-slack-secret";
process.env.SLACK_CLIENT_ID              = "test-slack-client-id";
process.env.SLACK_CLIENT_SECRET          = "test-slack-client-secret";

// ── Stub crypto.randomUUID globally ──────────────────────────────────────────
let _uuidCounter = 0;
vi.stubGlobal("crypto", {
  ...crypto,
  randomUUID: () => `test-uuid-${String(++_uuidCounter).padStart(4, "0")}`,
  subtle: crypto.subtle,
});

// ── Stub global fetch to prevent accidental real network calls ────────────────
// Individual tests override this with vi.spyOn(globalThis, "fetch")
vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
  new Error("fetch() called without a mock — stub it per-test with vi.spyOn(globalThis, 'fetch')"),
));
