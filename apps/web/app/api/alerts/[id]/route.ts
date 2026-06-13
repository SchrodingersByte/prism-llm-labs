import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

function isPublicUrl(raw: string | null | undefined): boolean {
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

const UpdateAlertSchema = z.object({
  name:            z.string().min(1).max(100).optional(),
  threshold_value: z.number().positive().optional(),
  channels:        z.array(z.enum(["email", "slack", "webhook"])).min(1).optional(),
  slack_webhook:   z.string().url().nullable().optional(),
  custom_webhook:  z.string().url().nullable().optional(),
  is_active:       z.boolean().optional(),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateAlertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: (parsed.error.issues[0] ? `${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}` : "Invalid request") }, { status: 400 });
  }

  if (!isPublicUrl(parsed.data.slack_webhook)) {
    return NextResponse.json({ error: "Invalid slack_webhook URL" }, { status: 400 });
  }
  if (!isPublicUrl(parsed.data.custom_webhook)) {
    return NextResponse.json({ error: "Invalid custom_webhook URL" }, { status: 400 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error: dbErr } = await (admin as any)
    .from("alert_rules")
    .update(parsed.data)
    .eq("id", params.id)
    .eq("org_id", ctx.orgId)
    .select("*")
    .single();

  if (dbErr) return NextResponse.json({ error: "Failed to update alert rule" }, { status: 500 });

  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbErr } = await (admin as any)
    .from("alert_rules")
    .delete()
    .eq("id", params.id)
    .eq("org_id", ctx.orgId);

  if (dbErr) return NextResponse.json({ error: "Failed to delete alert rule" }, { status: 500 });

  return NextResponse.json({ success: true });
}
