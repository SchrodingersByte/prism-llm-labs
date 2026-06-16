/**
 * /api/metrics/errors (PRD-6)
 *
 * GET — error clusters for the org: failing LLM calls (llm_events status >= 400)
 * + failing non-LLM spans (spans status='error'), grouped by signature with
 * occurrence counts + last-seen. Reads the error_clusters pipe.
 *   ?days=7  ?project_id=
 * Org member, read-only. Powers the (deferred) error explorer UI.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { queryTinybird } from "@/lib/tinybird/client";

export const runtime = "nodejs";

const tb = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const url       = new URL(req.url);
  const days      = Math.min(Number(url.searchParams.get("days") ?? 7), 90);
  const projectId = url.searchParams.get("project_id") ?? "";

  const params: Record<string, string> = {
    org_id:    member.org_id,
    from_date: tb(new Date(Date.now() - days * 86_400_000)),
    to_date:   tb(new Date()),
  };
  if (projectId) params.project_id = projectId;

  try {
    const clusters = await queryTinybird("error_clusters", params);
    return NextResponse.json({ clusters });
  } catch {
    return NextResponse.json({ error: "Failed to fetch error clusters" }, { status: 500 });
  }
}
