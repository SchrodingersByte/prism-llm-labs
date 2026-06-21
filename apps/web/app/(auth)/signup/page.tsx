"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Eye, EyeOff, MailCheck } from "lucide-react";
import { GitHubIcon, GoogleIcon } from "@/components/auth/oauth-icons";
import { AuthShowcase } from "@/components/auth/AuthShowcase";

function SignupForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const redirectTo   = searchParams.get("next") ?? "/onboarding";

  const [name,     setName]     = useState("");
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [loading,  setLoading]  = useState<"email" | "github" | "google" | null>(null);
  const [error,    setError]    = useState("");
  const [sent,     setSent]     = useState(false);

  const supabase = createClient();

  async function handleEmailSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading("email");
    setError("");
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
        data: name ? { full_name: name } : undefined,
      },
    });
    if (error) {
      setError(error.message);
      setLoading(null);
    } else if (data.session) {
      // Auto-confirm on — go straight into onboarding.
      router.push(redirectTo);
      router.refresh();
    } else {
      // Email confirmation required.
      setSent(true);
      setLoading(null);
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

  if (sent) {
    return (
      <div className="w-full max-w-[360px] mx-auto text-center">
        <div
          className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full"
          style={{ background: "var(--page-to)" }}
        >
          <MailCheck className="h-6 w-6" style={{ color: "var(--ink-900)" }} />
        </div>
        <h1 className="text-[1.6rem] leading-tight mb-2" style={{ color: "var(--ink-900)" }}>
          <span className="font-light italic">Check your </span>
          <span className="font-black">inbox.</span>
        </h1>
        <p className="text-sm mb-6" style={{ color: "var(--ink-500)" }}>
          We sent a confirmation link to <span className="font-medium" style={{ color: "var(--ink-700)" }}>{email}</span>.
          Click it to activate your account and start tracking spend.
        </p>
        <Link
          href="/login"
          className="btn-outline inline-flex items-center justify-center w-full py-2.5 rounded-lg text-sm font-medium"
        >
          Back to sign in
        </Link>
      </div>
    );
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
        <span className="font-light italic">Create your </span>
        <span className="font-black">account.</span>
      </h1>
      <p className="text-sm mb-7" style={{ color: "var(--ink-300)" }}>
        Start free — no credit card required.
      </p>

      {/* GitHub */}
      <button
        type="button"
        onClick={() => handleOAuth("github")}
        disabled={loading !== null}
        className="btn-primary flex items-center justify-center gap-2.5 w-full py-2.5 rounded-lg text-sm font-medium mb-3"
      >
        <GitHubIcon />
        {loading === "github" ? "Redirecting…" : "Sign up with GitHub"}
      </button>

      {/* Google */}
      <button
        type="button"
        onClick={() => handleOAuth("google")}
        disabled={loading !== null}
        className="btn-outline flex items-center justify-center gap-2.5 w-full py-2.5 rounded-lg text-sm font-medium"
      >
        <GoogleIcon />
        {loading === "google" ? "Redirecting…" : "Sign up with Google"}
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px" style={{ background: "var(--ink-100)" }} />
        <span className="text-xs" style={{ color: "var(--ink-300)" }}>or</span>
        <div className="flex-1 h-px" style={{ background: "var(--ink-100)" }} />
      </div>

      {/* Form */}
      <form onSubmit={handleEmailSignUp} className="flex flex-col gap-3.5">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--ink-700)" }}>
            Full name <span style={{ color: "var(--ink-300)" }}>(optional)</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ada Lovelace"
            autoComplete="name"
            className="input-brand w-full px-3 py-2.5 rounded-lg text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--ink-700)" }}>
            Work email
          </label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            autoComplete="email"
            className="input-brand w-full px-3 py-2.5 rounded-lg text-sm"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--ink-700)" }}>
            Password
          </label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder="At least 8 characters"
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
          {loading === "email" ? "Creating account…" : <>Create account <span aria-hidden>→</span></>}
        </button>
      </form>

      <p className="text-center text-[11px] mt-4 leading-relaxed" style={{ color: "var(--ink-300)" }}>
        By creating an account you agree to our{" "}
        <Link href="/terms" className="nav-link">Terms</Link> and{" "}
        <Link href="/privacy" className="nav-link">Privacy Policy</Link>.
      </p>

      <p className="text-center text-xs mt-5" style={{ color: "var(--ink-300)" }}>
        Already have an account?{" "}
        <Link href="/login" className="nav-link font-medium">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function SignupPage() {
  return (
    <div className="flex min-h-screen">
      {/* Left — form */}
      <div className="
        relative flex flex-col justify-center
        w-full md:w-[35%] md:min-w-[360px] md:max-w-[520px]
        bg-white border-r border-r-[var(--ink-100)]
        px-8 sm:px-12 py-12
        overflow-y-auto
      ">
        <Suspense>
          <SignupForm />
        </Suspense>
      </div>

      {/* Right — rolling feature showcase, hidden on mobile */}
      <div className="relative hidden flex-1 md:block">
        <AuthShowcase />
      </div>
    </div>
  );
}
