/**
 * /api/evaluations/datasets
 *
 * GET  — list datasets for the org
 * POST — create a dataset (name + description + samples)
 */

import { NextRequest, NextResponse }        from "next/server";
import { z }                                from "zod";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { createAdminClient }                from "@/lib/supabase/server";
import { canWriteOrg }                       from "@/lib/supabase/metrics-scope";

export const runtime = "nodejs";

// ── GET ────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const url    = new URL(req.url);
  const limit  = Math.min(Number(url.searchParams.get("limit")  ?? 50), 200);
  const offset = Number(url.searchParams.get("offset") ?? 0);

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, count, error } = await (admin as any)
    .from("evaluation_datasets")
    .select("id, name, description, created_at, samples", { count: "exact" })
    .eq("org_id", member.org_id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: "Failed to fetch datasets" }, { status: 500 });

  // Return sample count (not the raw samples array) for the list view
  const datasets = (data ?? []).map((d: {
    id: string; name: string; description: string | null;
    created_at: string; samples: unknown;
  }) => ({
    id:           d.id,
    name:         d.name,
    description:  d.description,
    created_at:   d.created_at,
    sample_count: Array.isArray(d.samples) ? d.samples.length : 0,
  }));

  return NextResponse.json({ datasets, total: count ?? 0, limit, offset });
}

// ── POST ───────────────────────────────────────────────────────────────────────

const SampleSchema = z.object({
  input:           z.string().min(1),
  expected_output: z.string().optional(),
  tags:            z.record(z.string()).optional(),
});

const CreateDatasetSchema = z.object({
  name:        z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  samples:     z.array(SampleSchema).min(1).max(500),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await canWriteOrg(user.id, member.org_id))) {
    return NextResponse.json({ error: "Read-only members cannot create datasets" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = CreateDatasetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });
  }

  const { name, description, samples } = parsed.data;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("evaluation_datasets")
    .insert({ org_id: member.org_id, name, description: description ?? null, samples })
    .select("id, name, description, created_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to create dataset" }, { status: 500 });
  }

  return NextResponse.json({
    dataset: { ...data, sample_count: samples.length },
  }, { status: 201 });
}
