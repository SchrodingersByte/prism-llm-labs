/**
 * POST /api/test/reset — internal-only Tinybird data reset for E2E tests.
 *
 * Double-gated:
 *   1. x-prism-test-secret header must match PRISM_TEST_SECRET env var
 *   2. NODE_ENV must not be "production" (prevents accidental prod data loss)
 *
 * Body: { org_id: string }
 * Deletes all rows for the given org from: llm_events, mcp_tool_events, outcome_events
 *
 * Never deploy to production with PRISM_TEST_SECRET set.
 */

import { NextRequest, NextResponse } from "next/server";

const DATASOURCES = ["llm_events", "mcp_tool_events", "outcome_events"];

async function deleteTinybirdRows(datasource: string, condition: string): Promise<void> {
  const base  = process.env.TINYBIRD_API_URL!;
  const token = process.env.TINYBIRD_ADMIN_TOKEN!;

  if (!base || !token) {
    throw new Error("TINYBIRD_API_URL and TINYBIRD_ADMIN_TOKEN must be set");
  }

  const res = await fetch(`${base}/v0/datasources/${encodeURIComponent(datasource)}/delete`, {
    method:  "POST",
    headers: {
      Authorization:  `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ delete_condition: condition }),
  });

  if (!res.ok) {
    const text = await res.text();
    // 404 means the datasource has no rows yet — treat as success
    if (res.status === 404) return;
    throw new Error(`Tinybird delete failed for ${datasource}: ${res.status} ${text}`);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Gate 1: never run in production
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not allowed in production" }, { status: 403 });
  }

  // Gate 2: secret header check
  const testSecret    = process.env.PRISM_TEST_SECRET;
  const headerSecret  = req.headers.get("x-prism-test-secret");

  if (!testSecret || !headerSecret || headerSecret !== testSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const orgId = (body as { org_id?: string })?.org_id;
  if (!orgId || typeof orgId !== "string" || orgId.length < 10) {
    return NextResponse.json({ error: "org_id is required (must be a UUID)" }, { status: 400 });
  }

  // Sanitize org_id — must be a UUID to prevent SQL injection
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(orgId)) {
    return NextResponse.json({ error: "org_id must be a valid UUID" }, { status: 400 });
  }

  const condition = `org_id = '${orgId}'`;

  try {
    await Promise.all(
      DATASOURCES.map((ds) => deleteTinybirdRows(ds, condition)),
    );
  } catch (err) {
    console.error("[test/reset] Tinybird delete error:", err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok:          true,
    org_id:      orgId,
    datasources: DATASOURCES,
  });
}
