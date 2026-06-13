/**
 * Platform admin authentication.
 *
 * Identity is managed via the PLATFORM_ADMIN_EMAILS environment variable
 * (comma-separated list of email addresses). No DB table needed.
 *
 * Usage (API route handlers):
 *   const guard = await requirePlatformAdmin(request);
 *   if (guard) return guard;  // 403 if not a platform admin
 *
 * Usage (Server Components / middleware):
 *   const ok = await isPlatformAdmin(email);
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

function getAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdmin(email: string): boolean {
  const admins = getAdminEmails();
  return admins.length > 0 && admins.includes(email.toLowerCase());
}

/**
 * Verify the current session user is a platform admin.
 * Returns a NextResponse(403) if not authorized, null to proceed.
 */
export async function requirePlatformAdmin(
  _req?: NextRequest,
): Promise<NextResponse | null> {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user?.email || !isPlatformAdmin(user.email)) {
      return NextResponse.json(
        { error: "platform_admin_required" },
        { status: 403 },
      );
    }
    return null;
  } catch {
    return NextResponse.json(
      { error: "platform_admin_required" },
      { status: 403 },
    );
  }
}
