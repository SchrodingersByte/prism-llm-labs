import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createServerClient } from "@/lib/supabase/server";
import { z } from "zod";

const Schema = z.object({
  org_name: z.string().min(1).max(100),
  user_id:  z.string().uuid(),
});

/**
 * POST /api/auth/create-org
 * Creates a NEW organization and switches the caller into it. Multi-org by
 * design — each org is a separate instance (org_id + RLS isolation), so this
 * does NOT dedupe against existing membership. (The idempotent post-signup
 * bootstrap lives in /api/auth/ensure-org.)
 */
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const { org_name, user_id } = parsed.data;

  // Prevent creating an org on behalf of another user
  if (user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Unique global slug (organizations.slug is UNIQUE) — a short random suffix
  // lets the same user reuse an org name across separate instances.
  const base = org_name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const slug = `${base || "org"}-${Math.random().toString(36).slice(2, 8)}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (admin as any)
    .from("organizations").insert({ name: org_name, slug }).select("id").single() as { data: { id: string } | null };

  if (!org) return NextResponse.json({ error: "Failed to create org" }, { status: 500 });

  // Org-scoped owner membership (satisfies the >=1-owner invariant;
  // scope_type defaults to 'organization', role NOT NULL).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("members")
    .insert({ org_id: org.id, user_id, scope_type: "organization", role: "owner" });

  // Default project so the dashboard is immediately usable
  // (projects.slug is required and unique per org).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("projects")
    .insert({ org_id: org.id, name: "Default", slug: "default" });

  // Switch the caller into the new org (active-org selector).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("user_preferences")
    .upsert(
      { user_id, active_org_id: org.id, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );

  return NextResponse.json({ org_id: org.id });
}
