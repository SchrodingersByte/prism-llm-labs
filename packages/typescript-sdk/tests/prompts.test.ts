/**
 * Prompt registry fetch tests (PRD-4): mapping, {{variable}} compilation,
 * in-memory caching, and error paths.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { getPrompt, clearPromptCache } from "../src/prompts";

const API_KEY = "prism_live_testorg_randomkey";

const RESOLVE_PAYLOAD = {
  name: "support-reply",
  version: 3,
  content: [
    { role: "system", content: "You are a helpful agent." },
    { role: "user", content: "Hello {{customer}}" },
  ],
  config: { temperature: 0.2 },
  prompt_version: "support-reply@3",
};

function mockFetch(payload: Record<string, unknown>, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } }),
  );
}

describe("getPrompt", () => {
  afterEach(() => { vi.restoreAllMocks(); clearPromptCache(); });

  it("resolves a prompt by name+label and maps the payload", async () => {
    const fetchSpy = mockFetch(RESOLVE_PAYLOAD);
    const p = await getPrompt("support-reply", { apiKey: API_KEY, baseUrl: "https://example.test", label: "production" });

    expect(p.version).toBe(3);
    expect(p.promptVersion).toBe("support-reply@3");
    expect(p.messages).toHaveLength(2);
    expect(p.config).toEqual({ temperature: 0.2 });

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://example.test/api/prompts/resolve?name=support-reply&label=production");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
  });

  it("compiles {{variables}} into message contents", async () => {
    mockFetch(RESOLVE_PAYLOAD);
    const p = await getPrompt("support-reply", { apiKey: API_KEY, label: "production" });
    const msgs = p.compile({ customer: "Dana" });
    expect(msgs[1].content).toBe("Hello Dana");
    // original messages are not mutated
    expect(p.messages[1].content).toBe("Hello {{customer}}");
  });

  it("caches within the TTL (one fetch for repeated reads)", async () => {
    const fetchSpy = mockFetch(RESOLVE_PAYLOAD);
    await getPrompt("support-reply", { apiKey: API_KEY, label: "production" });
    await getPrompt("support-reply", { apiKey: API_KEY, label: "production" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("pins an explicit version via the version query param", async () => {
    const fetchSpy = mockFetch(RESOLVE_PAYLOAD);
    await getPrompt("support-reply", { apiKey: API_KEY, baseUrl: "https://example.test", version: 2 });
    expect(fetchSpy.mock.calls[0]![0]).toBe("https://example.test/api/prompts/resolve?name=support-reply&version=2");
  });

  it("requires an API key", async () => {
    const prev = process.env.PRISM_API_KEY;
    delete process.env.PRISM_API_KEY;
    await expect(getPrompt("x")).rejects.toThrow(/missing API key/);
    if (prev) process.env.PRISM_API_KEY = prev;
  });

  it("throws on a non-2xx response", async () => {
    mockFetch({ error: "Prompt not found" }, 404);
    await expect(getPrompt("nope", { apiKey: API_KEY })).rejects.toThrow(/Prompt not found/);
  });
});
