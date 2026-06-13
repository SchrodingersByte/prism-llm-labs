/**
 * createPrismMiddleware — Next.js middleware utility for automatic feature tagging.
 *
 * Injects `x-prism-feature` headers on every LLM-related API route so that
 * spend_by_feature attribution works without touching each route handler.
 *
 * Usage in middleware.ts:
 *
 *   import { createPrismMiddleware } from "@prism-llm-labs/sdk/middleware";
 *   import { NextResponse } from "next/server";
 *
 *   const prism = createPrismMiddleware();
 *
 *   export function middleware(request) {
 *     const res = NextResponse.next();
 *     prism(request, res);
 *     return res;
 *   }
 *
 *   // Or with explicit feature map:
 *   const prism = createPrismMiddleware({
 *     featureMap: { "/api/chat": "chat-assistant", "/api/summarize": "summarize" },
 *   });
 */

export interface PrismMiddlewareConfig {
  /**
   * Explicit route → feature name mapping.
   * Takes precedence over autoInfer.
   * Keys are exact pathname prefixes (e.g. "/api/chat").
   */
  featureMap?: Record<string, string>;

  /**
   * When true (default), automatically infer the feature name from the URL path:
   *   /api/chat          → "chat"
   *   /api/v1/summarize  → "summarize"
   *   /api/search/docs   → "search"
   */
  autoInfer?: boolean;

  /**
   * Only tag requests matching this pathname prefix (default: "/api").
   * Set to "/" to tag all routes.
   */
  apiPrefix?: string;
}

type RequestLike = { nextUrl?: { pathname: string }; url?: string; headers: { set(k: string, v: string): void; get?(k: string): string | null } };
type ResponseLike = { headers: { set(k: string, v: string): void } };

function inferFeature(pathname: string): string | undefined {
  // Strip /api/ and optional /v{n}/ version prefix, take the next segment
  const match = pathname.match(/\/api\/(?:v\d+\/)?([^/?#]+)/);
  return match?.[1];
}

function getPathname(request: RequestLike): string {
  if (request.nextUrl?.pathname) return request.nextUrl.pathname;
  if (request.url) {
    try { return new URL(request.url).pathname; } catch { /* fall through */ }
  }
  return "";
}

/**
 * Returns a function that tags the request with `x-prism-feature`.
 * Call it inside your Next.js middleware function.
 */
export function createPrismMiddleware(config: PrismMiddlewareConfig = {}) {
  const { featureMap = {}, autoInfer = true, apiPrefix = "/api" } = config;

  return function tagRequest(request: RequestLike, _response?: ResponseLike): string | undefined {
    const pathname = getPathname(request);

    if (!pathname.startsWith(apiPrefix)) return undefined;

    // Explicit map takes priority
    for (const [prefix, feature] of Object.entries(featureMap)) {
      if (pathname === prefix || pathname.startsWith(prefix + "/")) {
        request.headers.set("x-prism-feature", feature);
        return feature;
      }
    }

    // Auto-infer from path
    if (autoInfer) {
      const feature = inferFeature(pathname);
      if (feature) {
        request.headers.set("x-prism-feature", feature);
        return feature;
      }
    }

    return undefined;
  };
}
