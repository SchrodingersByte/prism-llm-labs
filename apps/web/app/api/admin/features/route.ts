import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/platform-admin";
import { setFeatureConfig } from "@/lib/billing/feature-guard";
import { createAdminClient, createServerClient } from "@/lib/supabase/server";

const PatchSchema = z.object({
  key:           z.string().min(1),
  status:        z.enum(["disabled", "beta", "live"]).optional(),
  min_plan:      z.enum(["developer", "startup", "enterprise"]).optional(),
  override_orgs: z.array(z.string().uuid()).optional(),
});

export async function GET(req: NextRequest) {
  const guard = await requirePlatformAdmin(req);
  if (guard) return guard;

  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any)
      .from("platform_features")
      .select("*")
      .order("category")
      .order("name");

    if (error) throw error;
    return NextResponse.json({ features: data ?? [] });
  } catch {
    return NextResponse.json({ error: "Failed to load features" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
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

  const { key, ...patch } = parsed.data;

  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    await setFeatureConfig(key, patch, user?.email ?? "admin");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to update feature" }, { status: 500 });
  }
}
