import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isConfigured as jacksonConfigured } from "@/lib/jackson/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/sso/check?domain=company.com
 *
 * Public endpoint — no auth required. Returns { exists: true } when an
 * active SSO config exists for the domain. Used by the login form to surface
 * the "Continue with SSO" button without leaking any config details.
 */
export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain")?.toLowerCase().trim();

  if (!domain || !jacksonConfigured()) {
    return NextResponse.json({ exists: false });
  }

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("sso_configs")
    .select("id")
    .eq("domain", domain)
    .eq("is_active", true)
    .maybeSingle() as { data: { id: string } | null };

  return NextResponse.json({ exists: Boolean(data) });
}
