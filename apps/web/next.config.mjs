import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // This repo had no .eslintrc — `next build` silently skipped linting
    // entirely (Next.js only wires ESLint into the build when a config is
    // present), and `next lint` hung on its first-run interactive setup
    // prompt in non-interactive shells. Adding `.eslintrc.json` (so
    // `pnpm --filter web lint` finally works as a standalone command) made
    // `next build` start enforcing it too — surfacing ~150 pre-existing
    // errors across the codebase that predate this change and are unrelated
    // to it. `ignoreDuringBuilds` restores the build's previous (passing)
    // behaviour — compile + typecheck + generate, as it always has — while
    // `pnpm --filter web lint` remains a real, separately-run quality gate
    // for paying down that debt deliberately rather than as a build blocker.
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    return [
      // Clean gateway URLs — allows `OPENAI_BASE_URL=https://useprism.dev/v1`
      // The OpenAI SDK appends /chat/completions, making the full path /v1/chat/completions
      { source: "/v1/:path*",          destination: "/api/gateway/openai/v1/:path*" },
      { source: "/openai/v1/:path*",   destination: "/api/gateway/openai/v1/:path*" },
      { source: "/anthropic/:path*",   destination: "/api/gateway/anthropic/:path*" },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options",           value: "DENY" },
          { key: "X-Content-Type-Options",     value: "nosniff" },
          { key: "Referrer-Policy",            value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",         value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

// Only wire up Sentry's webpack plugin when a token is present.
// Without a token, sentry-cli exits with 401 and crashes the build —
// silent:true suppresses logging but does not swallow the process exit.
// In CI (and local builds without .env.local) we skip it entirely.
const sentryToken = process.env.SENTRY_AUTH_TOKEN;

export default sentryToken
  ? withSentryConfig(nextConfig, {
      org:            process.env.SENTRY_ORG,
      project:        process.env.SENTRY_PROJECT,
      authToken:      sentryToken,
      silent:         true,
      hideSourceMaps: true,
      disableLogger:  true,
    })
  : nextConfig;
