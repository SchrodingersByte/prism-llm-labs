import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { redis } from "@/lib/upstash/redis";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const jobId = req.nextUrl.searchParams.get("job_id");
  if (!jobId) return NextResponse.json({ error: "Missing job_id" }, { status: 400 });

  const raw = await redis.get<string>(`billing:sync:job:${jobId}`);
  if (!raw) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  try {
    const job = typeof raw === "string" ? JSON.parse(raw) : raw;
    return NextResponse.json(job);
  } catch {
    return NextResponse.json({ error: "Invalid job state" }, { status: 500 });
  }
}
