/**
 * Shared display-name resolution helpers.
 *
 * Priority order:
 *   1. user_metadata.full_name   (populated by Google / GitHub OAuth)
 *   2. user_metadata.name        (some OAuth providers use this key)
 *   3. email local-part          (prettified: dots/hyphens → spaces, Title Case)
 *   4. first 8 chars of user_id  (last resort)
 */

interface AuthUserLike {
  id: string;
  email?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user_metadata?: Record<string, any>;
}

export function resolveDisplayName(user: AuthUserLike): string {
  const fromMeta =
    (user.user_metadata?.full_name as string | undefined)?.trim()
    ?? (user.user_metadata?.name as string | undefined)?.trim();

  if (fromMeta) return fromMeta;

  const email = user.email ?? "";
  if (!email) return user.id.slice(0, 8);

  const local = email.split("@")[0] ?? "";
  const pretty = local
    .replace(/[._+\-]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
    .trim();

  return pretty || email;
}

/**
 * Batch-fetch all Supabase auth users and return a Map<userId → displayName>.
 * Caller passes the admin client (typed as any to avoid coupling to the SDK version).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function buildDisplayNameMap(adminClient: any): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { data: authData } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
  for (const u of authData?.users ?? []) {
    map.set(u.id, resolveDisplayName(u));
  }
  return map;
}
