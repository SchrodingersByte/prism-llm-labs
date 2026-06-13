import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("notifications")
    .select("id, type, title, body, action_url, metadata, is_read, created_at, org_id")
    .eq("user_id", ctx.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unread_count = (data ?? []).filter((n: any) => !n.is_read).length;

  return NextResponse.json({ data: data ?? [], unread_count });
}
