/**
 * Real tests for the billing-sync ORCHESTRATOR (lib/billing/sync.ts) — AREA 4 / T4.5.
 *
 * Unlike the "contract"/"error isolation" cases in billing.test.ts (which
 * re-implement the logic inline and assert on the copy), these invoke the actual
 * `syncAllConnections` with the vendor adapters + Supabase + Tinybird mocked, and
 * assert the real `mcp_cost_reconciliation` upsert payloads + dispatch routing.
 * This is the "prove it" for reconciliation that's achievable without live creds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted capture state (vi.mock factories run before module init) ──────────
const H = vi.hoisted(() => ({
  upserts:  [] as Array<{ table: string; payload: Record<string, unknown>; options: Record<string, unknown> }>,
  tinybird: [] as Array<{ ds: string; rows: Record<string, unknown>[] }>,
  cfg:      { connections: [] as unknown[], reconRows: [] as unknown[], toolEvents: [] as unknown[] },
  adapters: {
    pinecone:   [] as unknown[],
    qdrantColl: [] as unknown[],
    qdrantUsage: { costUsd: 0 },
    gcp:        [] as unknown[],
  },
}));

// Supabase: a thenable, chainable builder. Awaiting the builder resolves {data}
// (sync.ts loads connections via `await query`); upsert() captures payloads.
vi.mock("@supabase/supabase-js", () => {
  const make = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    const ret = () => b;
    for (const m of ["select", "eq", "neq", "gte", "lte", "gt", "lt", "in", "is", "limit", "order"]) b[m] = ret;
    b.update = () => ({ eq: () => Promise.resolve({ data: null, error: null }) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.upsert = (payload: any, options: any) => { H.upserts.push({ table, payload, options }); return Promise.resolve({ data: null, error: null }); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.then = (resolve: any, reject?: any) => {
      const data = table === "cloud_billing_connections" ? H.cfg.connections
        : table === "mcp_cost_reconciliation" ? H.cfg.reconRows
        : table === "mcp_tool_events" ? H.cfg.toolEvents
        : null;
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    };
    return b;
  };
  return { createClient: () => ({ from: (t: string) => make(t) }) };
});

vi.mock("@/lib/crypto/keys", () => ({
  decryptKey: () => JSON.stringify({
    api_key: "k", cluster_url: "https://cluster.example.com",
    accessKeyId: "AKIATEST", secretAccessKey: "secret", region: "us-east-1",
  }),
}));

vi.mock("@/lib/tinybird/client", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ingestToTinybird: (rows: any[], ds: string) => { H.tinybird.push({ ds, rows }); return Promise.resolve(); },
}));

vi.mock("@/lib/billing/pinecone", () => ({ getPineconeDetailRows: vi.fn(async () => H.adapters.pinecone) }));
vi.mock("@/lib/billing/qdrant", () => ({
  getQdrantCollectionRows: vi.fn(async () => H.adapters.qdrantColl),
  getQdrantUsage:          vi.fn(async () => H.adapters.qdrantUsage),
}));
vi.mock("@/lib/billing/weaviate", () => ({ getWeaviateClassRows: vi.fn(async () => []) }));
vi.mock("@/lib/billing/gcp", () => ({ getGcpCostRows: vi.fn(async () => H.adapters.gcp) }));
vi.mock("@/lib/billing/milvus", () => ({ getMilvusCollectionRows: vi.fn(async () => []) }));
vi.mock("@/lib/billing/aws", () => ({ getCostsByService: vi.fn(async () => []), getCostsByTag: vi.fn(async () => 0) }));
vi.mock("@/lib/billing/azure", () => ({ getAzureCostRows: vi.fn(async () => []) }));

import { syncAllConnections } from "@/lib/billing/sync";
import { getPineconeDetailRows } from "@/lib/billing/pinecone";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function conn(overrides: Record<string, unknown> = {}): any {
  return {
    id: "conn-1", org_id: "org-1", provider: "pinecone", display_name: "Conn",
    credentials_encrypted: "enc", config: {}, attribution_mode: "detail", ...overrides,
  };
}
const reconRows = () => H.upserts.filter(u => u.table === "mcp_cost_reconciliation");

beforeEach(() => {
  H.upserts.length  = 0;
  H.tinybird.length = 0;
  H.cfg.connections = [];
  H.cfg.reconRows   = [];
  H.cfg.toolEvents  = [];
  Object.assign(H.adapters, { pinecone: [], qdrantColl: [], qdrantUsage: { costUsd: 0 }, gcp: [] });
  vi.mocked(getPineconeDetailRows).mockImplementation(async () => H.adapters.pinecone as never);
});

describe("syncAllConnections() — Pinecone row shaping", () => {
  it("writes separate read/write/storage rows with the correct mcp_cost_reconciliation shape", async () => {
    H.cfg.connections = [conn({ provider: "pinecone", config: { environment: "production", indexes: ["support-docs"] } })];
    H.adapters.pinecone = [{
      indexName: "support-docs", readUnits: 1e6, writeUnits: 5e5, storageGb: 2,
      readCostUsd: 1.0, writeCostUsd: 1.0, storageCostUsd: 0.5, totalCostUsd: 2.5,
    }];

    const results = await syncAllConnections();
    const r = reconRows();

    expect(r).toHaveLength(3);
    expect(r.map(u => u.payload.operation_type).sort()).toEqual(["read", "storage", "write"]);
    for (const u of r) {
      expect(u.payload.org_id).toBe("org-1");
      expect(u.payload.cost_source).toBe("pinecone_usage_api");
      expect(u.payload.resource_name).toBe("pinecone:support-docs");
      expect(u.payload.estimated_cost).toBe(0);
      expect(u.payload.session_id).toBe("");
      expect(u.payload.environment).toBe("production");
      expect(u.options.onConflict).toBe("org_id,event_id");
      expect(String(u.payload.event_id)).toMatch(/^pinecone-support-docs-(read|write|storage)-/);
    }
    expect(results[0].provider).toBe("pinecone");
    expect(results[0].total_cost_usd).toBeCloseTo(2.5, 4);
    expect(results[0].records_written).toBe(3);
  });

  it("skips operations whose cost is zero", async () => {
    H.cfg.connections = [conn({ provider: "pinecone" })];
    H.adapters.pinecone = [{
      indexName: "idx", readUnits: 0, writeUnits: 0, storageGb: 1,
      readCostUsd: 0, writeCostUsd: 0, storageCostUsd: 0.3, totalCostUsd: 0.3,
    }];
    await syncAllConnections();
    const r = reconRows();
    expect(r).toHaveLength(1);
    expect(r[0].payload.operation_type).toBe("storage");
  });
});

describe("syncAllConnections() — dispatch routing", () => {
  it("routes gcp → gcp_cloud_billing compute rows", async () => {
    H.cfg.connections = [conn({ provider: "gcp", config: { environment: "prod" } })];
    H.adapters.gcp = [{ resourceName: "instance/vm-1", costUsd: 12.34, sessionId: "" }];
    await syncAllConnections();
    const r = reconRows();
    expect(r).toHaveLength(1);
    expect(r[0].payload.cost_source).toBe("gcp_cloud_billing");
    expect(r[0].payload.resource_name).toBe("gcp:instance/vm-1");
    expect(r[0].payload.operation_type).toBe("compute");
    expect(r[0].payload.actual_cost).toBeCloseTo(12.34, 4);
  });

  it("routes qdrant → per-collection request rows", async () => {
    H.cfg.connections = [conn({ provider: "qdrant" })];
    H.adapters.qdrantColl = [{ collectionName: "docs", costUsd: 3 }, { collectionName: "faq", costUsd: 1 }];
    await syncAllConnections();
    const r = reconRows();
    expect(r).toHaveLength(2);
    expect(r.map(u => u.payload.resource_name).sort()).toEqual(["qdrant:docs", "qdrant:faq"]);
    expect(r.every(u => u.payload.cost_source === "qdrant_billing_api")).toBe(true);
    expect(r.every(u => u.payload.operation_type === "request")).toBe(true);
  });

  it("returns an error result for unsupported providers (no rows written)", async () => {
    H.cfg.connections = [conn({ provider: "snowflake" })];
    const results = await syncAllConnections();
    expect(results[0].error).toContain("unsupported provider: snowflake");
    expect(reconRows()).toHaveLength(0);
  });
});

describe("syncAllConnections() — resilience + Tinybird emit", () => {
  it("isolates a failing connection so others still sync", async () => {
    H.cfg.connections = [conn({ id: "c1", provider: "pinecone" }), conn({ id: "c2", provider: "gcp" })];
    vi.mocked(getPineconeDetailRows).mockRejectedValueOnce(new Error("Pinecone API timeout"));
    H.adapters.gcp = [{ resourceName: "vm", costUsd: 5, sessionId: "" }];

    const results = await syncAllConnections();
    const pc = results.find(r => r.connection_id === "c1")!;
    const gc = results.find(r => r.connection_id === "c2")!;

    expect(pc.error).toContain("Pinecone API timeout");
    expect(gc.error).toBeUndefined();
    expect(gc.records_written).toBe(1);
    expect(reconRows().some(u => u.payload.cost_source === "gcp_cloud_billing")).toBe(true);
  });

  it("emits actual_billing_records to Tinybird for successful syncs", async () => {
    H.cfg.connections = [conn({ provider: "pinecone", display_name: "Prod Pinecone", config: { environment: "production" } })];
    H.adapters.pinecone = [{
      indexName: "idx", readUnits: 1, writeUnits: 0, storageGb: 0,
      readCostUsd: 4.0, writeCostUsd: 0, storageCostUsd: 0, totalCostUsd: 4.0,
    }];

    await syncAllConnections();
    await new Promise(r => setTimeout(r, 0)); // let the fire-and-forget emit flush

    const emit = H.tinybird.find(e => e.ds === "actual_billing_records");
    expect(emit).toBeTruthy();
    expect(emit!.rows[0].provider).toBe("pinecone");
    expect(emit!.rows[0].actual_cost_usd).toBeCloseTo(4.0, 4);
    expect(emit!.rows[0].cost_source).toBe("pinecone");
    expect(emit!.rows[0].resource_name).toBe("Prod Pinecone");
    expect(emit!.rows[0].environment).toBe("production");
  });
});
