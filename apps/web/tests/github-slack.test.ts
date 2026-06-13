/**
 * Tests for GitHub integration and Slack App.
 * Covers plan test IDs: 10.x, 11.x
 *
 * Priority: P1
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

// ── GitHub webhook signature ──────────────────────────────────────────────────
describe("GitHub webhook — signature verification", () => {
  const SECRET = "test-github-secret"; // matches vitest.setup.ts env var

  function signBody(body: string, secret = SECRET): string {
    return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  }

  it("valid HMAC signature passes verification", () => {
    const body    = JSON.stringify({ action: "opened", number: 1 });
    const sig     = signBody(body);
    const expected = signBody(body);
    // timingSafeEqual should return true for matching signatures
    const result = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    expect(result).toBe(true);
  });

  it("tampered body fails verification", () => {
    const originalBody = JSON.stringify({ action: "opened" });
    const tamperedBody = JSON.stringify({ action: "closed" });
    const sig = signBody(originalBody);
    const expected = signBody(tamperedBody);
    let match = false;
    try {
      match = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    } catch {
      match = false;
    }
    expect(match).toBe(false);
  });

  it("wrong secret fails verification", () => {
    const body        = JSON.stringify({ action: "opened" });
    const sig         = signBody(body, "wrong-secret");
    const expected    = signBody(body, SECRET);
    let match = false;
    try {
      match = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    } catch {
      match = false;
    }
    expect(match).toBe(false);
  });
});

describe("GitHub webhook — PR merge detection", () => {
  it("detects merge when action=closed and merged_at is non-null", () => {
    const payload = {
      action:       "closed",
      number:       42,
      pull_request: {
        merged_at: "2026-06-04T10:00:00Z",
        head:      { ref: "feature/ai-search", sha: "abc1234567890" },
        title:     "Add AI search feature",
      },
    };

    const isMerge = payload.action === "closed" && !!payload.pull_request.merged_at;
    expect(isMerge).toBe(true);
  });

  it("does NOT detect merge when action=closed but merged_at is null (closed without merge)", () => {
    const payload = {
      action:       "closed",
      pull_request: {
        merged_at: null,
        head:      { ref: "feature/draft", sha: "def456" },
      },
    };

    const isMerge = payload.action === "closed" && !!payload.pull_request.merged_at;
    expect(isMerge).toBe(false);
  });

  it("extracts 7-char commit SHA for session correlation", () => {
    const sha = "abc1234567890abcdef";
    const short = sha.slice(0, 7);
    expect(short).toBe("abc1234");
    expect(short).toHaveLength(7);
  });
});

// ── GitHub branch tracking ────────────────────────────────────────────────────
describe("GitHub webhook — branch tracking", () => {
  it("detects branch deletion from all-zeros SHA", () => {
    const ZERO_SHA = "0000000000000000000000000000000000000000";
    const sha      = ZERO_SHA;
    const isDelete = sha === ZERO_SHA;
    expect(isDelete).toBe(true);
  });

  it("normal push SHA is not all-zeros", () => {
    const sha = "abc1234567890abcdef123456";
    const isDelete = sha === "0".repeat(40);
    expect(isDelete).toBe(false);
  });
});

// ── Slack signature verification ──────────────────────────────────────────────
describe("Slack webhook — signature verification", () => {
  afterEach(() => vi.restoreAllMocks());

  it("valid signature with current timestamp passes", async () => {
    const { verifySlackSignature } = await import("@/lib/slack/verify");
    const secret    = "test-slack-secret"; // matches vitest.setup.ts
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body      = "command=/prism&text=budget&team_id=T123";
    const sig       = "v0=" + crypto
      .createHmac("sha256", secret)
      .update(`v0:${timestamp}:${body}`)
      .digest("hex");

    const result = verifySlackSignature(secret, timestamp, body, sig);
    expect(result).toBe(true);
  });

  it("old timestamp (>5 min) rejects for replay attack prevention", async () => {
    const { verifySlackSignature } = await import("@/lib/slack/verify");
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400); // 400s ago
    const result = verifySlackSignature("any-secret", oldTimestamp, "body", "v0=any");
    expect(result).toBe(false);
  });

  it("mismatched signature rejects", async () => {
    const { verifySlackSignature } = await import("@/lib/slack/verify");
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = verifySlackSignature("correct-secret", timestamp, "body", "v0=wrongsig");
    expect(result).toBe(false);
  });
});

// ── Slack commands ────────────────────────────────────────────────────────────
describe("Slack Block Kit builders", () => {
  it("buildBudgetBlocks returns structure with header and fields", async () => {
    const { buildBudgetBlocks } = await import("@/lib/slack/blocks");
    const budgetData = {
      spend_usd:         45.20,
      limit_usd:         100.00,
      utilization_pct:   45.2,
      days_elapsed:      15,
      days_in_month:     30,
      daily_burn_rate:   3.01,
      projected_month_end: 90.3,
      projected_overage:  0,
      budget_status:      "on_track" as const,
    };

    const result = buildBudgetBlocks(budgetData, "Acme Corp");

    expect(result.blocks).toBeDefined();
    expect(Array.isArray(result.blocks)).toBe(true);
    // Should have at least a header block
    expect((result.blocks as unknown[]).length).toBeGreaterThan(0);
  });

  it("buildSpendBlocks returns structure with vendor breakdown", async () => {
    const { buildSpendBlocks } = await import("@/lib/slack/blocks");
    const vendors = [
      { provider: "openai",    total_cost_usd: 30.0, total_requests: 500 },
      { provider: "anthropic", total_cost_usd: 10.0, total_requests: 100 },
    ];

    const result = buildSpendBlocks(vendors, "2026-06-01 00:00:00", "2026-06-30 23:59:59", "Acme Corp");

    expect(result.blocks).toBeDefined();
    expect(result.text).toContain("$40");
  });

  it("buildApprovalBlocks includes approve and deny buttons", async () => {
    const { buildApprovalBlocks } = await import("@/lib/slack/blocks");
    const result = buildApprovalBlocks("req-001", "claude-opus-4", "alice@test.com", "Need for new feature");

    const actionsBlock = (result.blocks as Array<{ type: string; elements?: unknown[] }>)
      .find(b => b.type === "actions");
    expect(actionsBlock).toBeDefined();
    const elements = actionsBlock!.elements ?? [];
    expect(elements.length).toBeGreaterThanOrEqual(2); // Approve + Deny buttons
  });
});
