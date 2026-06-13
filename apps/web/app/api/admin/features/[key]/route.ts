import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { setFeatureConfig } from "@/lib/billing/feature-guard";
import { createAdminClient, createServerClient } from "@/lib/supabase/server";

const PatchSchema = z.object({
  status:        z.enum(["disabled", "beta", "live"]).optional(),
  min_plan:      z.enum(["developer", "startup", "enterprise"]).optional(),
  override_orgs: z.array(z.string().uuid()).optional(),
});

type RouteContext = { params: { key: string } };

export async function GET(req: NextRequest, { params }: RouteContext) {
  const guard = await requirePlatformAdmin(req);
  if (guard) return guard;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("platform_features")
    .select("*")
    .eq("key", params.key)
    .maybeSingle();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ feature: data });
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const guard = await requirePlatformAdmin(req);
  if (guard) return guard;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    await setFeatureConfig(params.key, parsed.data, user?.email ?? "admin");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to update feature" }, { status: 500 });
  }
}

// POST /api/admin/features/[key]/override — add an org to the override list
export async function POST(req: NextRequest, { params }: RouteContext) {
  const guard = await requirePlatformAdmin(req);
  if (guard) return guard;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = z.object({ org_id: z.string().uuid() }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: feature } = await (admin as any)
      .from("platform_features")
      .select("override_orgs")
      .eq("key", params.key)
      .maybeSingle() as { data: { override_orgs: string[] } | null };

    if (!feature) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updated = Array.from(new Set([...feature.override_orgs, parsed.data.org_id]));

    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    await setFeatureConfig(params.key, { override_orgs: updated }, user?.email ?? "admin");
    return NextResponse.json({ ok: true, override_orgs: updated });
  } catch {
    return NextResponse.json({ error: "Failed to add override" }, { status: 500 });
  }
}

// DELETE /api/admin/features/[key]/override?org_id=... — remove an org
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  const guard = await requirePlatformAdmin(req);
  if (guard) return guard;

  const orgId = req.nextUrl.searchParams.get("org_id");
  if (!orgId) return NextResponse.json({ error: "org_id required" }, { status: 400 });

  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: feature } = await (admin as any)
      .from("platform_features")
      .select("override_orgs")
      .eq("key", params.key)
      .maybeSingle() as { data: { override_orgs: string[] } | null };

    if (!feature) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updated = feature.override_orgs.filter(id => id !== orgId);

    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    await setFeatureConfig(params.key, { override_orgs: updated }, user?.email ?? "admin");
    return NextResponse.json({ ok: true, override_orgs: updated });
  } catch {
    return NextResponse.json({ error: "Failed to remove override" }, { status: 500 });
  }
}
