import { describe, it, expect } from "vitest";
import { PrismMcpProxy } from "../src/proxy.js";

describe("PrismMcpProxy", () => {
  it("constructs without throwing when no key is set", () => {
    // Should warn but not throw — observability must never crash the app
    const proxy = new PrismMcpProxy("echo", ["hello"], {
      prismKey:   "",
      serverName: "test-server",
      project:    "proj-1",
    });
    expect(proxy).toBeDefined();
  });

  it("derives server name from target command basename", () => {
    // serverName should default to the last segment of the command path
    const proxy = new PrismMcpProxy(
      "/usr/local/bin/my-mcp-server",
      [],
      { prismKey: "prism_live_abc_def" },
    );
    // Access via cast to test private field
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((proxy as any).opts.serverName).toBe("my-mcp-server");
  });

  it("accepts all option overrides", () => {
    const proxy = new PrismMcpProxy("cmd", [], {
      prismKey:              "prism_live_abc_def",
      serverName:            "my-server",
      project:               "proj",
      team:                  "team-a",
      environment:           "staging",
      sessionId:             "sess-123",
      sessionBudgetUsd:      0.50,
      maxToolCallsPerSession: 100,
      captureInputs:         true,
      captureOutputs:        true,
      costOverrides:         { bash: 0.005 },
      ingestUrl:             "https://example.com/api/mcp/ingest",
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = (proxy as any).opts;
    expect(opts.serverName).toBe("my-server");
    expect(opts.sessionBudgetUsd).toBe(0.50);
    expect(opts.maxToolCallsPerSession).toBe(100);
    expect(opts.captureInputs).toBe(true);
    expect(opts.costOverrides).toEqual({ bash: 0.005 });
  });
});
