/**
 * Node.js require hook — loaded via:
 *   node --require @prism-llm-labs/enforce/register app.js
 *
 * Patches Module._load to intercept raw AI provider SDK imports
 * and substitute Prism-wrapped versions.
 *
 * This file is CJS-only (loaded before ESM resolution).
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("module") as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismEnforceError } = require("./errors");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execSync } = require("child_process") as { execSync: (cmd: string, opts: object) => Buffer };

type EnforceMode = "transparent" | "warn" | "strict";

const mode: EnforceMode =
  (process.env["PRISM_ENFORCE_MODE"] as EnforceMode | undefined) ?? "transparent";

/** Run a git command, return trimmed stdout or "" on failure. */
function safeExec(cmd: string): string {
  try {
    return execSync(cmd, { stdio: ["pipe","pipe","pipe"], timeout: 1000 }).toString().trim();
  } catch { return ""; }
}

/** Read package.json name from cwd — fallback when not run via npm. */
function readPackageName(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs   = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const pkgPath = path.join(process.cwd(), "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { name?: string };
      return pkg.name ?? "";
    }
  } catch { /* ignore */ }
  return "";
}

/** Capture git branch + commit + app name at hook load time (once). */
function captureContext(): { git_branch: string; git_commit: string; app_name: string } {
  const branch = (
    process.env["GITHUB_REF_NAME"] ??
    process.env["GIT_BRANCH"]      ??
    process.env["BRANCH_NAME"]     ??
    safeExec("git rev-parse --abbrev-ref HEAD")
  );

  const commit = (
    process.env["GITHUB_SHA"] ??
    process.env["GIT_COMMIT"] ??
    safeExec("git rev-parse --short HEAD")
  ).slice(0, 7);

  // npm_package_name is set by npm run scripts; fall back to package.json or env
  const appName = (
    process.env["npm_package_name"] ??
    process.env["PRISM_APP_NAME"]   ??
    readPackageName()
  );

  return {
    git_branch: branch === "HEAD" ? "" : (branch ?? ""),
    git_commit: commit ?? "",
    app_name:   appName,
  };
}

// Capture once at startup — avoids repeated subprocess calls on every intercepted import
const ctx = captureContext();

/**
 * Report a bypass event to the Prism enforce API.
 * Fire-and-forget via http.request (no fetch dependency in CJS register hooks).
 */
function reportBypass(moduleName: string): void {
  const key = process.env["PRISM_API_KEY"];
  if (!key || mode === "transparent") return;

  const appUrl = (
    process.env["PRISM_APP_URL"] ??
    process.env["NEXT_PUBLIC_APP_URL"] ??
    "https://useprism.dev"
  ).replace(/\/$/, "");

  const body = JSON.stringify({
    raw_module:  moduleName,
    environment: process.env["NODE_ENV"] ?? "production",
    git_branch:  ctx.git_branch,
    git_commit:  ctx.git_commit,
    app_name:    ctx.app_name,
  });

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require("https") as typeof import("https");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const http  = require("http")  as typeof import("http");
    const parsed = new URL(`${appUrl}/api/enforce/status`);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path:     parsed.pathname,
      method:   "POST",
      headers:  {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${key}`,
        "Content-Length": Buffer.byteLength(body),
      },
    });
    req.on("error", () => {});  // never propagate
    req.write(body);
    req.end();
  } catch { /* never propagate */ }
}

/**
 * Map of raw module names → factory that returns the Prism equivalent.
 * Factories are lazy to avoid circular imports at startup.
 */
const INTERCEPT_MAP: Record<string, () => unknown> = {
  "openai": () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const prism = require("@prism-llm-labs/sdk");
    return { default: prism.OpenAI, OpenAI: prism.OpenAI };
  },
  "@anthropic-ai/sdk": () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const prism = require("@prism-llm-labs/sdk");
    return { default: prism.PrismAnthropic, Anthropic: prism.PrismAnthropic };
  },
  "@google/generative-ai": () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const prism = require("@prism-llm-labs/sdk");
    return { default: prism.PrismGoogleGenerativeAI, GoogleGenerativeAI: prism.PrismGoogleGenerativeAI };
  },
};

// Only patch if PRISM_API_KEY is set
if (process.env["PRISM_API_KEY"]) {
  const originalLoad = Module._load;

  /**
   * loading: re-entrancy guard — prevents the hook from firing again while
   * the INTERCEPT_MAP factory is already resolving the same module (e.g. the
   * Prism SDK internally requires 'openai', which would trigger the hook again).
   */
  const loading = new Set<string>();

  /**
   * reported: fire-once guard — each raw module name produces exactly one
   * bypass event + one warning per process lifetime, no matter how many times
   * the caller does require('openai').
   */
  const reported = new Set<string>();

  Module._load = function patchedLoad(
    request: string,
    parent:  unknown,
    isMain:  boolean,
  ): unknown {
    if (request in INTERCEPT_MAP) {
      // Re-entrant call from within the Prism SDK loader — pass through directly
      if (loading.has(request)) {
        return originalLoad.call(this, request, parent, isMain);
      }

      // First time this module is intercepted in this process
      if (!reported.has(request)) {
        reported.add(request);

        if (mode === "strict") {
          throw new PrismEnforceError(request);
        }

        if (mode === "warn") {
          process.stderr.write(
            `[prism-enforce] WARNING: raw import of "${request}" detected ` +
            `(branch: ${ctx.git_branch || "unknown"}, app: ${ctx.app_name || "unknown"}). ` +
            `Import from "@prism-llm-labs/sdk" to ensure cost tracking.\n`,
          );
          reportBypass(request);
        }
      }

      loading.add(request);
      try {
        return INTERCEPT_MAP[request]!();
      } catch {
        return originalLoad.call(this, request, parent, isMain);
      } finally {
        loading.delete(request);
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  if (mode !== "transparent") {
    process.stderr.write(
      `[prism-enforce] Active in ${mode} mode` +
      (ctx.git_branch ? ` on branch ${ctx.git_branch}` : "") +
      (ctx.app_name   ? ` (${ctx.app_name})` : "") +
      ` — monitoring for raw provider SDK imports.\n`,
    );
  }
}
