/**
 * POST /api/auth/ensure-org
 * Called client-side after a successful OAuth/magic-link exchange to make sure
 * the newly-authenticated user has an org and member row. Idempotent — safe to
 * call multiple times. This is the post-signup BOOTSTRAP; explicit additional
 * orgs are created via /api/auth/create-org.
 */
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin as any)
    .from("members")
    .select("org_id")
    .eq("user_id", user.id)
    .maybeSingle() as { data: { org_id: string } | null };

  if (existing) {
    return NextResponse.json({ ok: true, created: false });
  }

  // New user — create org + owner member row + Default project.
  const emailBase = (user.email ?? "workspace").split("@")[0] ?? "workspace";
  const slug      = `${emailBase.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${user.id.slice(0, 6)}`;

  let orgId: string | null = null;

  // plan defaults to 'free' (organizations.plan CHECK = free|pro|team|enterprise).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted } = await (admin as any)
    .from("organizations")
    .insert({ name: emailBase, slug })
    .select("id")
    .single() as { data: { id: string } | null };

  if (inserted) {
    orgId = inserted.id;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: found } = await (admin as any)
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle() as { data: { id: string } | null };
    orgId = found?.id ?? null;
  }

  if (!orgId) return NextResponse.json({ ok: true, created: false });

  // Org-scoped owner membership (satisfies the >=1-owner invariant;
  // scope_type defaults to 'organization', role NOT NULL).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("members")
    .upsert(
      { org_id: orgId, user_id: user.id, scope_type: "organization", role: "owner" },
      { onConflict: "org_id,user_id", ignoreDuplicates: true },
    );

  // Auto-create a Default project so the dashboard is immediately accessible
  // (projects.slug is required and unique per org).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("projects")
    .insert({ org_id: orgId, name: "Default", slug: "default" })
    .select("id")
    .maybeSingle();

  return NextResponse.json({ ok: true, created: true });
}
