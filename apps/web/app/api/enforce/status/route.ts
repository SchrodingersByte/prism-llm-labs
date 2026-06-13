/**
 * GET /api/enforce/status
 * Returns SDK bypass events for the authenticated org, enriched with user + git context.
 *
 * POST /api/enforce/status
 * Records a bypass event — called by the enforce hook (auth: Prism API key).
 * Accepts git_branch, git_commit, app_name alongside raw_module + environment.
 * Denormalises key_name and assigned_user_email at insert time.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { authenticateIngestKey } from "@/lib/ingest/auth";
import { ingestToTinybird } from "@/lib/tinybird/client";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

// ── GET: dashboard reads bypass events ──────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const from  = req.nextUrl.searchParams.get("from");
  const to    = req.nextUrl.searchParams.get("to");
  const days  = parseInt(req.nextUrl.searchParams.get("days") ?? "7", 10);
  const since = from ? new Date(from).toISOString()
                     : new Date(Date.now() - days * 86_400_000).toISOString();
  const until = to   ? new Date(to + "T23:59:59.999Z").toISOString()
                     : new Date().toISOString();

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data } = await admin
    .from("sdk_bypass_events")
    .select("id, raw_module, environment, occurred_at, key_id, key_name, assigned_user_email, git_branch, git_commit, app_name")
    .eq("org_id", member.org_id)
    .gte("occurred_at", since)
    .lte("occurred_at", until)
    .order("occurred_at", { ascending: false })
    .limit(200);

  const events = data ?? [];

  // Aggregates
  const byModule: Record<string, number> = {};
  const byUser:   Record<string, number> = {};
  const byBranch: Record<string, number> = {};

  for (const row of events) {
    // by module
    byModule[row.raw_module] = (byModule[row.raw_module] ?? 0) + 1;

    // by user — use email if known, else key name, else "unassigned"
    const userKey = row.assigned_user_email
      ?? (row.key_name ? `(key) ${row.key_name}` : "(unassigned)");
    byUser[userKey] = (byUser[userKey] ?? 0) + 1;

    // by branch
    if (row.git_branch) {
      byBranch[row.git_branch] = (byBranch[row.git_branch] ?? 0) + 1;
    }
  }

  return NextResponse.json({
    total:     events.length,
    by_module: byModule,
    by_user:   byUser,
    by_branch: byBranch,
    recent:    events.slice(0, 50),
  });
}

// ── POST: enforce hook reports a bypass ──────────────────────────────────────

const BypassSchema = z.object({
  raw_module:    z.string().min(1),
  environment:   z.string().default("production"),
  git_branch:    z.string().default(""),
  git_commit:    z.string().default(""),
  app_name:      z.string().default(""),
  service_name:  z.string().default(""),
  app_version:   z.string().default(""),
  enforce_mode:  z.enum(["transparent", "warn", "strict"]).default("transparent"),
  language:      z.enum(["node", "python"]).default("node"),
});

const CheckinSchema = z.object({
  service_name:  z.string().min(1),
  app_version:   z.string().default(""),
  enforce_mode:  z.enum(["transparent", "warn", "strict"]).default("transparent"),
  language:      z.enum(["node", "python"]).default("node"),
});

export async function POST(req: NextRequest) {
  const auth = await authenticateIngestKey(req.headers.get("authorization") ?? "");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const rawBody = await req.json().catch(() => ({}));

  // ── Checkin heartbeat (no raw_module = just a service checkin) ──────────
  if (!(rawBody as Record<string, unknown>).raw_module) {
    const checkin = CheckinSchema.safeParse(rawBody);
    if (!checkin.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    await admin.from("enforce_checkins").upsert(
      {
        org_id:       auth.key.org_id,
        service_name: checkin.data.service_name,
        app_version:  checkin.data.app_version  || null,
        enforce_mode: checkin.data.enforce_mode,
        language:     checkin.data.language,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "org_id,service_name", ignoreDuplicates: false },
    );
    return NextResponse.json({ ok: true });
  }

  const body = BypassSchema.safeParse(rawBody);
  if (!body.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Denormalise key_name and assigned_user_email at insert time
  let keyName = "";
  let assignedUserEmail = "";

  // assigned_user_id was dropped from api_keys — the assigned-user email denorm
  // below now always resolves empty (the optional cast yields undefined).
  const { data: keyRow } = await admin
    .from("api_keys")
    .select("name")
    .eq("id", auth.key.id)
    .maybeSingle();

  if (keyRow) {
    keyName = (keyRow as { name: string }).name ?? "";
    // assigned_user_id was dropped from api_keys — there is no assigned user to resolve,
    // so assignedUserEmail stays empty (the denormalised column is now always null).
  }

  await admin.from("sdk_bypass_events").insert({
    org_id:               auth.key.org_id,
    key_id:               auth.key.id,
    raw_module:           body.data.raw_module,
    environment:          body.data.environment,
    git_branch:           body.data.git_branch   || null,
    git_commit:           body.data.git_commit   || null,
    app_name:             body.data.app_name     || null,
    key_name:             keyName                || null,
    assigned_user_email:  assignedUserEmail      || null,
  });

  void ingestToTinybird([{
    event_id:             uuidv4(),
    timestamp:            new Date().toISOString().replace("T", " ").slice(0, 23),
    org_id:               auth.key.org_id,
    key_id:               auth.key.id,
    raw_module:           body.data.raw_module,
    environment:          body.data.environment,
    git_branch:           body.data.git_branch  || "",
    git_commit:           body.data.git_commit  || "",
    app_name:             body.data.app_name    || "",
    service_name:         body.data.service_name || body.data.app_name || "",
    language:             body.data.language,
    enforce_mode:         body.data.enforce_mode,
    key_name:             keyName               || "",
    assigned_user_email:  assignedUserEmail     || "",
  }], "sdk_bypass_events").catch(() => {});

  // Upsert a checkin row so the service appears in the shadow IT dashboard
  // even if it only fired a bypass event (without a separate heartbeat).
  const svcName = body.data.service_name || body.data.app_name;
  if (svcName) {
    await admin.from("enforce_checkins").upsert(
      {
        org_id:       auth.key.org_id,
        service_name: svcName,
        app_version:  body.data.app_version || null,
        enforce_mode: body.data.enforce_mode,
        language:     body.data.language,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "org_id,service_name", ignoreDuplicates: false },
    );
    // Increment bypass counter separately (non-atomic, acceptable for analytics)
    try {
      await admin.rpc("increment_checkin_bypass", {
        p_org_id:       auth.key.org_id,
        p_service_name: svcName,
      });
    } catch { /* graceful fail if RPC doesn't exist yet */ }
  }

  return NextResponse.json({ ok: true });
}
