import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/billing/feature-guard";
import { z } from "zod";

function isPublicUrl(raw: string | undefined): boolean {
  if (!raw) return true;
  let url: URL;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const h = url.hostname.toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1") return false;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b, c] = ipv4.map(Number);
    if (a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===169&&b===254)||a===0||a===127) return false;
  }
  return true;
}

const CreateAlertSchema = z.object({
  name:            z.string().min(1).max(100),
  project_id:      z.string().uuid().optional(),
  trigger_type:    z.enum([
    "budget_threshold", "spend_spike", "statistical_anomaly", "error_rate",
    "single_call_cost", "daily_limit", "pii_detection",
    "tool_call_loop", "session_budget_threshold", "velocity_spike",
  ]),
  threshold_value: z.number().positive(),
  channels:        z.array(z.enum(["email", "slack", "webhook"])).min(1).default(["email"]),
  slack_webhook:   z.string().url().optional(),
  custom_webhook:  z.string().url().optional(),
});

export async function GET() {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rules, error: dbErr } = await (admin as any)
    .from("alert_rules")
    .select("*")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false });

  if (dbErr) return NextResponse.json({ error: "DB error" }, { status: 500 });

  return NextResponse.json({ data: rules });
}

export async function POST(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateAlertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: (parsed.error.issues[0] ? `${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}` : "Invalid request") }, { status: 400 });
  }

  if (!isPublicUrl(parsed.data.slack_webhook)) {
    return NextResponse.json({ error: "Invalid slack_webhook URL" }, { status: 400 });
  }
  if (!isPublicUrl(parsed.data.custom_webhook)) {
    return NextResponse.json({ error: "Invalid custom_webhook URL" }, { status: 400 });
  }

  // Slack and webhook delivery channels are gated by the alerts_slack feature flag
  const needsSlack = parsed.data.channels.some(c => c === "slack" || c === "webhook");
  if (needsSlack) {
    const guard = await checkFeature(ctx.orgId, "alerts_slack");
    if (guard) return guard;
  }

  const admin = createAdminClient();

  if (parsed.data.project_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proj } = await (admin as any)
      .from("projects")
      .select("id")
      .eq("id", parsed.data.project_id)
      .eq("org_id", ctx.orgId)
      .maybeSingle();
    if (!proj) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error: dbErr } = await (admin as any)
    .from("alert_rules")
    .insert({
      org_id:          ctx.orgId,
      project_id:      parsed.data.project_id ?? null,
      name:            parsed.data.name,
      trigger_type:    parsed.data.trigger_type,
      threshold_value: parsed.data.threshold_value,
      channels:        parsed.data.channels,
      slack_webhook:   parsed.data.slack_webhook ?? null,
      custom_webhook:  parsed.data.custom_webhook ?? null,
    })
    .select("*")
    .single();

  if (dbErr) return NextResponse.json({ error: "Failed to create alert rule" }, { status: 500 });

  return NextResponse.json({ data: inserted }, { status: 201 });
}
