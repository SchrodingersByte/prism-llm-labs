import { type NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getAccessibleProjectIds } from "@/lib/supabase/metrics-scope";

export async function GET() {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  // Org-scoped members see all org projects; project-scoped members see only
  // their assigned projects (getAccessibleProjectIds branches on scope_type).
  const accessible = await getAccessibleProjectIds(ctx);
  if (accessible !== null && accessible.length === 0) {
    return NextResponse.json({ data: [] });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("projects")
    .select("id, name, description, monthly_budget_usd, created_at")
    .eq("org_id", ctx.orgId);
  if (accessible !== null) query = query.in("id", accessible);

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json() as { name?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const admin = createAdminClient();
  // No owner_id (dropped) and no project_members seed: the creating org
  // owner/administrator already has org-wide access to every project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("projects")
    .insert({ org_id: ctx.orgId, name, slug })
    .select("id, name")
    .single();

  if (error) {
    const msg = error.code === "23505" ? "A project with that name already exists" : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
