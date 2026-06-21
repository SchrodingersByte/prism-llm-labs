"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Eye, EyeOff } from "lucide-react";
import { GitHubIcon, GoogleIcon } from "@/components/auth/oauth-icons";
import { AuthShowcase } from "@/components/auth/AuthShowcase";

// ── Form (needs useSearchParams → Suspense boundary) ─────────────────────────

function LoginForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const redirectTo   = searchParams.get("next") ?? "/dashboard";

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState<"email" | "github" | "google" | null>(null);
  const [error,    setError]    = useState(searchParams.get("error") ?? "");

  const supabase = createClient();

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading("email");
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(null);
    } else {
      router.push(redirectTo);
      router.refresh();
    }
  }

  async function handleOAuth(provider: "github" | "google") {
    setLoading(provider);
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(null);
    }
  }

  return (
    <div className="w-full max-w-[360px] mx-auto">
      {/* Logo */}
      <div className="flex items-center gap-2.5 mb-8">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full text-white text-xs font-black"
          style={{ background: "var(--ink-900)" }}
        >
          P
        </span>
        <span className="text-sm font-semibold tracking-tight" style={{ color: "var(--ink-900)" }}>
          Prism
        </span>
      </div>

      {/* Heading */}
      <h1 className="text-[1.85rem] leading-tight mb-1.5" style={{ color: "var(--ink-900)" }}>
        <span className="font-light italic">Welcome </span>
        <span className="font-black">back.</span>
      </h1>
      <p className="text-sm mb-7" style={{ color: "var(--ink-300)" }}>
        Sign in to continue where you left off.
      </p>

      {/* GitHub */}
      <button
        type="button"
        onClick={() => handleOAuth("github")}
        disabled={loading !== null}
        className="btn-primary flex items-center justify-center gap-2.5 w-full py-2.5 rounded-lg text-sm font-medium mb-3"
      >
        <GitHubIcon />
        {loading === "github" ? "Redirecting…" : "Continue with GitHub"}
      </button>

      {/* Google */}
      <button
        type="button"
        onClick={() => handleOAuth("google")}
        disabled={loading !== null}
        className="btn-outline flex items-center justify-center gap-2.5 w-full py-2.5 rounded-lg text-sm font-medium"
      >
        <GoogleIcon />
        {loading === "google" ? "Redirecting…" : "Continue with Google"}
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px" style={{ background: "var(--ink-100)" }} />
        <span className="text-xs" style={{ color: "var(--ink-300)" }}>or</span>
        <div className="flex-1 h-px" style={{ background: "var(--ink-100)" }} />
      </div>

      {/* Form */}
      <form onSubmit={handleEmailSignIn} className="flex flex-col gap-3.5">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--ink-700)" }}>
            Email or username
          </label>
          <input
            type="text"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
            className="input-brand w-full px-3 py-2.5 rounded-lg text-sm"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium" style={{ color: "var(--ink-700)" }}>
              Password
            </label>
            <Link href="/forgot-password" className="nav-link-muted text-xs">
              Forgot?
            </Link>
          </div>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="input-brand w-full px-3 py-2.5 pr-10 rounded-lg text-sm"
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="nav-link absolute right-3 top-1/2 -translate-y-1/2"
              aria-label={showPw ? "Hide password" : "Show password"}
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading !== null}
          className="btn-primary flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-sm font-semibold mt-0.5"
        >
          {loading === "email" ? "Signing in…" : <>Sign in <span aria-hidden>→</span></>}
        </button>
      </form>

      <p className="text-center text-xs mt-6" style={{ color: "var(--ink-300)" }}>
        No account?{" "}
        <Link href="/signup" className="nav-link font-medium">
          Create one
        </Link>
      </p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">

      {/* ── Left panel — 35% on desktop, full-width on mobile ─────────────── */}
      <div className="
        relative flex flex-col justify-center
        w-full md:w-[35%] md:min-w-[360px] md:max-w-[520px]
        bg-white border-r border-r-[var(--ink-100)]
        px-8 sm:px-12 py-12
        overflow-y-auto
      ">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>

      {/* ── Right panel — rolling feature showcase, hidden on mobile ──────── */}
      <div className="relative hidden flex-1 md:block">
        <AuthShowcase />
      </div>

    </div>
  );
}
