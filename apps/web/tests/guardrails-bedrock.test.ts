import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GuardrailProfile } from "@/lib/gateway/guardrails/types";
import type { BedrockCredentials } from "@/lib/gateway/bedrock";

// Mock the AWS SDK so no real client is constructed and `send` is controllable.
const mockSend = vi.fn();
vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: vi.fn(() => ({ send: mockSend })),
  ApplyGuardrailCommand: vi.fn((input) => ({ __input: input })),
}));

beforeEach(() => mockSend.mockReset());

const CREDS: BedrockCredentials = { accessKeyId: "AKIA", secretAccessKey: "sec", region: "us-east-1" };
const load = () => import("@/lib/gateway/guardrails/providers/bedrock-guardrails");

describe("applyBedrockGuardrail()", () => {
  it("flags on GUARDRAIL_INTERVENED and surfaces assessment types + masked text", async () => {
    mockSend.mockResolvedValue({
      action:  "GUARDRAIL_INTERVENED",
      outputs: [{ text: "masked ***" }],
      assessments: [{
        sensitiveInformationPolicy: { piiEntities: [{ type: "EMAIL", action: "ANONYMIZED" }] },
        contentPolicy:              { filters: [{ type: "HATE", action: "BLOCKED" }] },
      }],
    });
    const { applyBedrockGuardrail } = await load();
    const res = await applyBedrockGuardrail(CREDS, { guardrailIdentifier: "gr-1", guardrailVersion: "DRAFT" }, "hi", "input");
    expect(res.flagged).toBe(true);
    expect(res.types).toEqual(expect.arrayContaining(["pii:email", "content:hate"]));
    expect(res.redactedPayload).toEqual(["masked ***"]);
  });

  it("does not flag on action NONE", async () => {
    mockSend.mockResolvedValue({ action: "NONE", outputs: [], assessments: [] });
    const { applyBedrockGuardrail } = await load();
    const res = await applyBedrockGuardrail(CREDS, { guardrailIdentifier: "gr-1", guardrailVersion: "1" }, "hi", "output");
    expect(res.flagged).toBe(false);
    expect(res.redactedPayload).toBeUndefined();
  });

  it("sends source=OUTPUT for the output direction", async () => {
    mockSend.mockResolvedValue({ action: "NONE" });
    const sdk = await import("@aws-sdk/client-bedrock-runtime");
    const { applyBedrockGuardrail } = await load();
    await applyBedrockGuardrail(CREDS, { guardrailIdentifier: "gr-1", guardrailVersion: "DRAFT" }, "text", "output");
    expect(sdk.ApplyGuardrailCommand).toHaveBeenCalledWith(expect.objectContaining({ source: "OUTPUT" }));
  });
});

describe("makeBedrockChecker()", () => {
  const bedrockProfile: GuardrailProfile = {
    id: "p1", name: "bedrock", type: "bedrock", config: { guardrail_id: "gr-1", guardrail_version: "DRAFT" },
  };

  it("no-ops for non-bedrock profiles", async () => {
    const { makeBedrockChecker } = await load();
    const checker = makeBedrockChecker(() => CREDS);
    const res = await checker({ id: "p", name: "x", type: "builtin_pii" }, ["hi"], "input");
    expect(res.flagged).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("no-ops when credentials cannot be resolved", async () => {
    const { makeBedrockChecker } = await load();
    const checker = makeBedrockChecker(() => null);
    const res = await checker(bedrockProfile, ["hi"], "input");
    expect(res.flagged).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("no-ops when the profile has no guardrail id", async () => {
    const { makeBedrockChecker } = await load();
    const checker = makeBedrockChecker(() => CREDS);
    const res = await checker({ id: "p", name: "b", type: "bedrock", config: {} }, ["hi"], "input");
    expect(res.flagged).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("calls ApplyGuardrail and maps the result for a valid bedrock profile", async () => {
    mockSend.mockResolvedValue({ action: "GUARDRAIL_INTERVENED", assessments: [{ topicPolicy: { topics: [{ name: "legal-advice" }] } }] });
    const { makeBedrockChecker } = await load();
    const checker = makeBedrockChecker(() => CREDS);
    const res = await checker(bedrockProfile, ["please advise"], "input");
    expect(res.flagged).toBe(true);
    expect(res.types).toContain("topic:legal-advice");
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
