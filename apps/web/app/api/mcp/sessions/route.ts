import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { queryTinybird } from "@/lib/tinybird/client";
import { z } from "zod";

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

const QuerySchema = z.object({
  from:       z.string().default(() => daysAgo(7)),
  to:         z.string().default(() => new Date().toISOString().replace("T", " ").slice(0, 19)),
  project_id: z.string().default(""),
  limit:      z.coerce.number().int().min(1).max(500).default(100),
});

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const member = await getMemberOrg(user.id);
  if (!member) {
    return NextResponse.json({ error: "No org" }, { status: 403 });
  }

  const params = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const { from, to, project_id, limit } = params.data;

  const data = await queryTinybird("sessions_list", {
    org_id:     member.org_id,
    from_date:  from,
    to_date:    to,
    project_id,
    limit:      String(limit),
  });

  return NextResponse.json({ data });
}
