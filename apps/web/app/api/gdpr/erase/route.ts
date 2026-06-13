import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, createAdminClient } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/billing/feature-guard";
import { ingestToTinybird, queryTinybird } from "@/lib/tinybird/client";

export const runtime = "nodejs";

const BodySchema = z.object({
  /** Erase events for a specific user within the org. Omit to erase all org events. */
  user_id: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  // ── Auth — org admin or owner only ──────────────────────────────────────
  const supabase      = createServerClient();
  const supabaseAdmin = createAdminClient();

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: member } = await supabase
    .from("members")
    .select("org_id, role")
    .eq("user_id", user.id)
    .maybeSingle() as { data: { org_id: string; role: string } | null };

  if (!member) {
    return NextResponse.json({ error: "No org membership found" }, { status: 403 });
  }

  const guard = await checkFeature(member.org_id, "gdpr_erase");
  if (guard) return guard;

  const adminRoles = ["owner"];
  if (!adminRoles.includes(member.role)) {
    return NextResponse.json({ error: "Only org owners and security admins can perform erasure" }, { status: 403 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: unknown;
  try { body = await req.json(); } catch { body = {}; }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const { user_id: targetUserId } = parsed.data;
  const orgId = member.org_id;

  // ── Fetch event IDs to erase from Tinybird ────────────────────────────────
  // Query the filtered view so we only grab non-already-erased events
  const queryParams: Record<string, string> = {
    org_id:    orgId,
    from_date: "2000-01-01 00:00:00",
    to_date:   "2099-12-31 23:59:59",
  };
  if (targetUserId) {
    queryParams.user_id = targetUserId;
  }

  let eventIds: string[];
  try {
    const rows = await queryTinybird("export_event_ids", queryParams) as Array<{ event_id: string }>;
    eventIds = rows.map((r) => r.event_id);
  } catch {
    // If the pipe doesn't exist yet, return a clear error
    return NextResponse.json(
      { error: "export_event_ids pipe not found in Tinybird — run tb push first" },
      { status: 503 },
    );
  }

  if (eventIds.length === 0) {
    return NextResponse.json({ erased: 0, message: "No events found to erase" });
  }

  // ── Write to erased_events datasource ────────────────────────────────────
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const erasedRows = eventIds.map((id) => ({ event_id: id, erased_at: now }));

  // Sequential (not Promise.all) so we know exactly how many were committed before
  // any failure. erased_events uses ReplacingMergeTree, so retrying is idempotent.
  let erased = 0;
  for (let i = 0; i < erasedRows.length; i += 500) {
    const chunk = erasedRows.slice(i, i + 500);
    try {
      await ingestToTinybird(chunk, "erased_events");
      erased += chunk.length;
    } catch {
      return NextResponse.json(
        {
          error:          "Tinybird write failed during erasure — retry to complete",
          erased_partial: erased,
          total:          eventIds.length,
        },
        { status: 207 },
      );
    }
  }

  // ── Anonymise Supabase PII ────────────────────────────────────────────────
  if (targetUserId) {
    // Anonymise audit log entries authored by the erased user
    await supabaseAdmin
      .from("audit_log")
      .update({ actor_user_id: null, metadata: {} })
      .eq("org_id", orgId)
      .eq("actor_user_id", targetUserId);
  } else {
    // Full org erasure — remove all org audit log data
    await supabaseAdmin.from("audit_log").delete().eq("org_id", orgId);
  }

  return NextResponse.json({ erased, user_id: targetUserId ?? "all" });
}
