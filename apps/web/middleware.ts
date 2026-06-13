import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export async function middleware(request: NextRequest) {
  // Guard: if Supabase env vars are not configured yet (e.g. during initial
  // deploy before env vars are set in the Vercel dashboard), pass the request
  // through rather than crashing with MIDDLEWARE_INVOCATION_FAILED.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options as Parameters<typeof supabaseResponse.cookies.set>[2]),
          );
        },
      },
    },
  );

  const path = request.nextUrl.pathname;

  // ── Auth error redirect ───────────────────────────────────────────────────
  // When the callback fails it redirects to /?auth_error=… — bounce the user
  // to /login so they see a useful error message instead of a blank page.
  if (path === "/" && request.nextUrl.searchParams.has("auth_error")) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?error=${encodeURIComponent(request.nextUrl.searchParams.get("msg") ?? "Authentication failed")}`;
    return NextResponse.redirect(loginUrl);
  }

  // ── Supabase OAuth code forwarding ───────────────────────────────────────
  // If a Supabase auth code lands on "/" or "/login" (happens when the Supabase
  // Site URL was misconfigured to the root), forward it to /auth/callback.
  // Only apply to non-API, non-auth paths — API routes like /api/github/callback
  // have their own code params that must NOT be intercepted here.
  const code = request.nextUrl.searchParams.get("code");
  if (code && !path.startsWith("/auth/") && !path.startsWith("/api/")) {
    const callbackUrl = request.nextUrl.clone();
    callbackUrl.pathname = "/auth/callback";
    return NextResponse.redirect(callbackUrl);
  }

  // ── Skip session check on auth routes ────────────────────────────────────
  // Do NOT call getUser() when on /auth/* — @supabase/ssr v0.5 can consume
  // the PKCE code-verifier cookie during getUser(), causing exchangeCodeForSession
  // in the route handler to fail with "PKCE code verifier not found".
  if (path.startsWith("/auth/")) {
    return supabaseResponse;
  }

  // Refresh session — do not remove this
  const { data: { user } } = await supabase.auth.getUser();

  // ── Platform admin guard ─────────────────────────────────────────────────
  if (path.startsWith("/admin")) {
    const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);
    if (!user?.email || !adminEmails.includes(user.email.toLowerCase())) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  if (!user && (path.startsWith("/dashboard") || path.startsWith("/onboarding"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    const returnTo = request.nextUrl.searchParams.get("return_to");
    if (returnTo?.startsWith("/join")) {
      url.pathname = returnTo.split("?")[0];
      url.search   = returnTo.includes("?") ? "?" + returnTo.split("?")[1] : "";
      return NextResponse.redirect(url);
    }
    url.pathname = "/dashboard";
    url.search   = "";
    return NextResponse.redirect(url);
  }

  // Authenticated users who revisit /onboarding but have already completed it
  // (onboarding_step >= 1) should be bounced to /dashboard.
  // We do NOT check the DB here (middleware is hot path) — the onboarding page
  // itself does the check client-side and redirects if already done.

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
