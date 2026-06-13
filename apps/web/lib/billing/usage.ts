/**
 * Usage metering — counts billable telemetry events per org for the current
 * calendar month. This is the Prism billing meter (events ingested), distinct
 * from the customer's own LLM spend caps (key_caps / customer_quota_profiles).
 *
 * Reads Tinybird directly via querySql. org_id is a trusted, DB-sourced UUID;
 * we still validate the format before interpolating (querySql does no binding).
 */
import { querySql } from "@/lib/tinybird/client";
import { getPlan } from "./plans";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UsageSummary {
  orgId:          string;
  periodStart:    string;
  eventsUsed:     number;
  eventsIncluded: number;   // Infinity for enterprise
  overage:        number;   // events beyond the included quota
  pctUsed:        number;   // 0–100+, 0 when quota is unlimited
}

function monthStartCh(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01 00:00:00`;
}

async function countSince(datasource: string, orgId: string, fromCh: string): Promise<number> {
  // Best-effort per source: a schema mismatch in one datasource must not break
  // the whole meter.
  try {
    const rows = await querySql(
      `SELECT count() AS n FROM ${datasource} ` +
      `WHERE org_id = '${orgId}' AND timestamp >= toDateTime('${fromCh}')`,
    ) as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Total billable events (LLM + MCP tool calls) for the org this month. */
export async function getMonthlyEventCount(orgId: string): Promise<number> {
  if (!UUID_RE.test(orgId)) return 0;
  const from = monthStartCh();
  const [llm, mcp] = await Promise.all([
    countSince("llm_events", orgId, from),
    countSince("mcp_tool_events", orgId, from),
  ]);
  return llm + mcp;
}

export async function getUsageSummary(orgId: string, plan: string | null | undefined): Promise<UsageSummary> {
  const eventsUsed = await getMonthlyEventCount(orgId);
  const included   = getPlan(plan).eventsIncluded;
  const finite     = Number.isFinite(included);
  return {
    orgId,
    periodStart:    monthStartCh(),
    eventsUsed,
    eventsIncluded: included,
    overage:        finite ? Math.max(0, eventsUsed - included) : 0,
    pctUsed:        finite && included > 0 ? (eventsUsed / included) * 100 : 0,
  };
}
