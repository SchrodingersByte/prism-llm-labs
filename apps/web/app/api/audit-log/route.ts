import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  const { searchParams } = req.nextUrl;
  const limit  = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200);
  const before = searchParams.get("before");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("audit_log")
    .select("id, action, target_type, target_id, metadata, created_at, actor_user_id")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data: entries, error: dbErr } = await query;
  if (dbErr) return NextResponse.json({ error: "DB error" }, { status: 500 });

  return NextResponse.json({ data: entries });
}
