import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

export type Tables = Database["public"]["Tables"];
export type OrgRow = Tables["organizations"]["Row"];
export type MemberRow = Tables["members"]["Row"];

// ── Unconfigured stub ─────────────────────────────────────────────────────────
// When NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set
// (e.g. during initial Vercel deploy before env vars are configured), the
// @supabase/ssr createServerClient throws "supabaseUrl is required" which
// crashes every server component with MIDDLEWARE_INVOCATION_FAILED /
// React error #419.  Return a minimal no-op stub instead so pages render
// with an unauthenticated state and a visible "configure Supabase" prompt.
//
// REMOVE this stub path once env vars are set in the Vercel dashboard.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _noopClient: any = {
  auth: {
    getUser:    async () => ({ data: { user: null },    error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
    signOut:    async () => ({ error: null }),
  },
  from: () => ({
    select:    (..._: unknown[]) => ({ data: null, error: null, count: null, eq: () => ({ data: null, error: null, count: null, maybeSingle: async () => ({ data: null, error: null }), limit: () => ({ data: null, error: null }) }) }),
    insert:    async () => ({ data: null, error: null }),
    update:    () => ({ eq: async () => ({ data: null, error: null }), is: async () => ({ data: null, error: null }) }),
    upsert:    async () => ({ data: null, error: null }),
    delete:    () => ({ eq: async () => ({ data: null, error: null }) }),
  }),
};

function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Resolve the active org_id for a user.
 * Checks user_preferences.active_org_id first (org switcher); falls back
 * to the most-recently-joined org when no preference is set or the preference
 * points to an org the user is no longer a member of.
 */
export async function getMemberOrg(
  userId: string,
): Promise<{ org_id: string } | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  // Attempt preference-based resolution (table may not exist on older deployments)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pref } = await (admin as any)
      .from("user_preferences")
      .select("active_org_id")
      .eq("user_id", userId)
      .maybeSingle() as { data: { active_org_id: string } | null };

    if (pref?.active_org_id) {
      // Verify the user still belongs to that org (guard against stale prefs)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: membership } = await (admin as any)
        .from("members")
        .select("org_id")
        .eq("user_id", userId)
        .eq("org_id", pref.active_org_id)
        .maybeSingle() as { data: { org_id: string } | null };

      if (membership) return membership;
    }
  } catch {
    // user_preferences table not yet created — fall through
  }

  // Fallback: most-recently-joined org
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("members")
    .select("org_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = Array.isArray(data) ? data[0] : null;
  return (row as { org_id: string } | null) ?? null;
}

export function createAdminClient() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return _noopClient;
  }
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function createServerClient() {
  if (!isSupabaseConfigured()) {
    return _noopClient;
  }

  const cookieStore = cookies();

  return createSupabaseServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options as Parameters<typeof cookieStore.set>[2]),
            );
          } catch {
            // Called from a Server Component — middleware handles session refresh
          }
        },
      },
    },
  );
}
