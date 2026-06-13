import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authenticateIngestKey } from "@/lib/ingest/auth";
import { incrementSessionSpend, incrementSessionToolCalls } from "@/lib/upstash/redis";
import { z } from "zod";

const MCP_TINYBIRD_URL = `${process.env.TINYBIRD_API_URL}/v0/events?name=mcp_tool_events`;

const McpEventSchema = z.object({
  event_id:             z.string(),
  timestamp:            z.string(),
  session_id:           z.string().min(1),
  org_id:               z.string().min(1),
  project_id:           z.string().default(""),
  team_id:              z.string().default(""),
  user_id:              z.string().default(""),
  environment:          z.string().default("production"),
  mcp_server_name:      z.string().default(""),
  tool_name:            z.string(),
  downstream_resource:  z.string().default(""),
  execution_latency_ms: z.number().int().nonnegative(),
  tool_cost_usd:        z.number().nonnegative().default(0),
  status:               z.enum(["ok", "error", "timeout"]).default("ok"),
  error_message:        z.string().default(""),
  llm_request_id:       z.string().default(""),
  tags:                 z.record(z.string()).default({}),
  primitive_type:       z.enum(["tool", "resource", "prompt", "sampling"]).default("tool"),
  cost_status:          z.enum(["estimated", "actual"]).default("estimated"),
  customer_id:          z.string().default(""),
});

const BatchSchema = z.object({
  events: z.array(McpEventSchema).min(1).max(500),
});

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const auth = await authenticateIngestKey(authHeader);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { key } = auth;

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = BatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const { events } = parsed.data;

  // Stamp org_id, project_id, and customer_id from the key / request headers
  // x-prism-customer-id header wins; falls back to event body; then empty string
  const customerId = req.headers.get("x-prism-customer-id")?.trim() ?? "";
  const sanitised = events.map((e) => ({
    ...e,
    org_id:      key.org_id,
    project_id:  key.project_id || e.project_id || "",
    user_id:     key.assigned_user_id ?? key.user_id ?? e.user_id ?? "",
    customer_id: customerId || e.customer_id || "",
  }));

  // Forward to Tinybird mcp_tool_events datasource
  const ndjson = sanitised.map((e) => JSON.stringify(e)).join("\n");
  try {
    const res = await fetch(MCP_TINYBIRD_URL, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${process.env.TINYBIRD_ADMIN_TOKEN}`,
        "Content-Type": "application/x-ndjson",
      },
      body: ndjson,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[prism] MCP Tinybird ingest failed:", text);
      return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
    }
  } catch (err) {
    console.error("[prism] MCP Tinybird ingest error:", err);
    return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
  }

  // Update Redis session counters — used by circuit breaker in SDK
  const totalCost   = sanitised.reduce((s, e) => s + e.tool_cost_usd, 0);
  const sessionIdSet = new Set(sanitised.map((e) => e.session_id));
  const sessionIds   = Array.from(sessionIdSet);
  await Promise.all(
    sessionIds.flatMap((sid) => {
      const sidEvents   = sanitised.filter((e) => e.session_id === sid);
      const sidCost     = sidEvents.reduce((s, e) => s + e.tool_cost_usd, 0);
      const sidToolCalls = sidEvents.length;
      return [
        incrementSessionSpend(key.org_id, sid, sidCost),
        incrementSessionToolCalls(key.org_id, sid, sidToolCalls),
      ];
    }),
  );

  // Update Supabase audit log
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  await supabase.from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", key.id);

  void totalCost; // used above, silence lint
  return NextResponse.json({ ok: true, ingested: sanitised.length });
}
