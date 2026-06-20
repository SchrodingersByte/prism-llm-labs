/**
 * GET /api/logs
 * Returns paginated request logs for the org with optional filters.
 * Only includes entries for keys that have prompt_logging_enabled = true.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const QuerySchema = z.object({
  limit:      z.coerce.number().int().min(1).max(200).default(50),
  offset:     z.coerce.number().int().min(0).default(0),
  model:      z.string().optional(),
  provider:   z.string().optional(),
  key_id:     z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
  status:     z.enum(["ok", "error", "all"]).default("all"),
  from:       z.string().optional(),
  to:         z.string().optional(),
  search:     z.string().max(200).optional(),   // search in prompt text
});

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const params = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const { limit, offset, model, provider, key_id, project_id, status, from, to, search } = params.data;
  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("request_logs")
    .select(`
      id, model, provider, input_tokens, output_tokens, cost_usd,
      latency_ms, status_code, session_id, git_branch, git_author,
      key_type, routed_from, created_at, api_key_id,
      trace_id, span_id,
      prompt, completion,
      api_keys ( name, key_prefix )
    `, { count: "exact" })
    .eq("org_id", member.org_id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (model)      query = query.eq("model", model);
  if (provider)   query = query.eq("provider", provider);
  if (key_id)     query = query.eq("api_key_id", key_id);
  if (project_id) query = query.eq("project_id", project_id);
  if (from)     query = query.gte("created_at", from);
  if (to)       query = query.lte("created_at", to);
  if (status === "ok")    query = query.lt("status_code", 400);
  if (status === "error") query = query.gte("status_code", 400);
  if (search)   query = query.ilike("completion", `%${search}%`);

  const { data, count, error: dbErr } = await query;
  if (dbErr) return NextResponse.json({ error: "DB error" }, { status: 500 });

  return NextResponse.json({ data: data ?? [], total: count ?? 0, limit, offset });
}
