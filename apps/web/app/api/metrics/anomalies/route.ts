/**
 * GET /api/metrics/anomalies
 *
 * Surfaces statistically-detected spend anomalies — days where daily cost
 * spiked past 2× the trailing 7-day rolling average (anomaly_detection pipe).
 *
 * Exposes getAnomalies() to the dashboard. Previously this pipe was queried
 * by dead code and never reached a UI surface or the alert pipeline.
 */

import { NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { resolveMetricsScopeFor, forbiddenScope } from "@/lib/supabase/metrics-scope";
import { getAnomalies } from "@/lib/tinybird/queries";

export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const scope = await resolveMetricsScopeFor(user.id, member.org_id, "");
  if (scope.kind === "forbidden") return forbiddenScope();
  if (scope.kind === "empty") return NextResponse.json({ anomalies: [] });
  const projectIds = scope.projectId ? [scope.projectId] : scope.projectIds;

  const anomalies = await getAnomalies(member.org_id, { projectIds }).catch(() => []);

  // Most recent first — the banner only cares about the latest spike(s)
  const sorted = [...anomalies].sort((a, b) => b.date.localeCompare(a.date));

  return NextResponse.json({ anomalies: sorted });
}
