/**
 * GET/PUT /api/preferences/layout
 *
 * Per-user Command Center widget layouts, stored in `user_preferences.dashboard_layouts`
 * (jsonb keyed by view: { org: string[], project: string[] }). Resilient by design:
 * if the column hasn't been migrated yet the route soft-fails (GET → null, PUT → ok:false)
 * so the client falls back to its localStorage layout instead of erroring.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { z } from "zod";

export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error: dbErr } = await (supabase as any)
      .from("user_preferences")
      .select("dashboard_layouts")
      .eq("user_id", user.id)
      .maybeSingle();
    if (dbErr) return NextResponse.json({ layouts: null }); // column not migrated yet
    return NextResponse.json({ layouts: data?.dashboard_layouts ?? null });
  } catch {
    return NextResponse.json({ layouts: null });
  }
}

const PutSchema = z.object({
  view: z.enum(["org", "project"]),
  ids:  z.array(z.string().max(64)).max(50),
});

export async function PUT(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { data: existing } = await sb
      .from("user_preferences").select("dashboard_layouts").eq("user_id", user.id).maybeSingle();
    const merged = { ...(existing?.dashboard_layouts ?? {}), [parsed.data.view]: parsed.data.ids };
    const { error: upErr } = await sb
      .from("user_preferences")
      .upsert({ user_id: user.id, dashboard_layouts: merged }, { onConflict: "user_id" });
    if (upErr) return NextResponse.json({ ok: false }); // column not migrated yet
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
