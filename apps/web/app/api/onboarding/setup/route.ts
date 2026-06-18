/**
 * POST /api/onboarding/setup
 *
 * Called once by new users from the /onboarding page.
 * - Renames the skeleton org (created by ensureUserOrg in auth/callback)
 * - Sets the chosen plan
 * - Marks onboarding_step = 1 so the user is never redirected here again
 * - Persists full_name + marketing_consent in Supabase auth user_metadata
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { generatePrismKey } from "@/lib/keys/generate";
import { z } from "zod";

const TOS_VERSION = "2024-01"; // bump this string whenever your ToS changes

const Schema = z.object({
  org_name:          z.string().min(1, "Organisation name is required").max(100),
  full_name:         z.string().max(120).optional(),
  plan:              z.enum(["free", "pro", "team", "enterprise"]),
  marketing_consent: z.boolean(),
  tos_accepted:      z.literal(true, {
    errorMap: () => ({ message: "You must accept the Terms of Service to continue" }),
  }),
});

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
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { org_name, full_name, plan, marketing_consent, tos_accepted } = parsed.data;

  const member = await getMemberOrg(user.id);
  if (!member) {
    return NextResponse.json({ error: "No organisation found for user" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Idempotency: only run the destructive setup (rename + plan + default key) on the
  // first pass. onboarding_step starts at 0 (auth/callback) and becomes 1 here, so a
  // re-submit (back button, double click) can't clobber the org name/slug/plan or mint
  // a second default key.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (admin as any)
    .from("organizations")
    .select("onboarding_step")
    .eq("id", member.org_id)
    .maybeSingle() as { data: { onboarding_step: number | null } | null };
  const firstRun = (org?.onboarding_step ?? 0) === 0;

  const now = new Date().toISOString();
  let apiKey: string | null = null;
  let apiKeyPrefix: string | null = null;

  if (firstRun) {
    // URL-safe slug from the org name + a short org-id suffix for uniqueness.
    const slugBase = org_name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    const slug = `${slugBase}-${member.org_id.slice(0, 6)}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: orgErr } = await (admin as any)
      .from("organizations")
      .update({ name: org_name, slug, plan, onboarding_step: 1 })
      .eq("id", member.org_id);
    if (orgErr) {
      console.error("[onboarding/setup] org update failed:", orgErr);
      return NextResponse.json({ error: "Failed to update organisation" }, { status: 500 });
    }

    // Auto-create one default analytics key (no provider links) scoped to the org's
    // default project, so the user can ingest immediately. The plaintext is returned
    // ONCE for the onboarding key-reveal step; only the hash + prefix are stored.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proj } = await (admin as any)
      .from("projects")
      .select("id")
      .eq("org_id", member.org_id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle() as { data: { id: string } | null };

    const gen = generatePrismKey("production", member.org_id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: keyErr } = await (admin as any)
      .from("api_keys")
      .insert({
        org_id:      member.org_id,
        project_id:  proj?.id ?? null,
        key_hash:    gen.keyHash,
        key_prefix:  gen.keyPrefix,
        name:        "Default",
        environment: "production",
        tags:        {},
        is_active:   true,
      });
    if (keyErr) {
      // Non-fatal: onboarding still completes; the user can create a key later.
      console.error("[onboarding/setup] default key creation failed:", keyErr);
    } else {
      apiKey       = gen.rawKey;
      apiKeyPrefix = gen.keyPrefix;
    }
  }

  // Consent record — single source of truth for legal + marketing (idempotent upsert).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: consentErr } = await (admin as any)
    .from("user_consents")
    .upsert(
      {
        user_id:             user.id,
        tos_accepted,
        tos_accepted_at:     tos_accepted ? now : null,
        tos_version:         TOS_VERSION,
        marketing_consent,
        marketing_updated_at: now,
      },
      { onConflict: "user_id" },
    );
  if (consentErr) console.error("[onboarding/setup] consent upsert failed:", consentErr);

  // Mirror consent + name into auth user_metadata for lightweight JWT reads.
  const { error: metaErr } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...user.user_metadata,
      ...(full_name ? { full_name, name: full_name } : {}),
      marketing_consent,
      tos_accepted,
      tos_accepted_at: now,
    },
  });
  if (metaErr) console.error("[onboarding/setup] auth metadata update failed:", metaErr);

  return NextResponse.json({ ok: true, api_key: apiKey, key_prefix: apiKeyPrefix });
}
