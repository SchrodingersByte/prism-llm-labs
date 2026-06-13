/**
 * Initiates GitHub App installation + user OAuth flow.
 *
 * For GitHub Apps, the `scope` parameter in the standard OAuth URL is ignored.
 * Instead we redirect to the App installation page which:
 *   1. Lets the user pick "All repositories" or specific repos (including private ones)
 *   2. Issues an installation_id + user OAuth code in the callback
 *
 * Required env vars: GITHUB_APP_SLUG, GITHUB_CLIENT_ID
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { buildInstallationUrl } from "@/lib/github/app";
import { checkFeature } from "@/lib/billing/feature-guard";

export async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const guard = await checkFeature(ctx.orgId, "github_connect");
  if (guard) return guard;

  const returnTo = req.nextUrl.searchParams.get("return_to") ?? "/dashboard/settings/connections";
  const state    = Buffer.from(
    JSON.stringify({ orgId: ctx.orgId, userId: ctx.user.id, returnTo }),
  ).toString("base64url");

  // Use the GitHub App installation URL so the user selects which repos to grant
  // access to (including private repos). The callback receives installation_id
  // alongside the OAuth code when the user completes installation.
  return NextResponse.redirect(buildInstallationUrl(state));
}
