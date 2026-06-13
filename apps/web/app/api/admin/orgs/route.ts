import { NextRequest, NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const guard = await requirePlatformAdmin(req);
  if (guard) return guard;

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("organizations")
    .select("id, name, plan")
    .order("name")
    .limit(20);

  if (q) query = query.ilike("name", `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Query failed" }, { status: 500 });
  return NextResponse.json({ orgs: data ?? [] });
}
