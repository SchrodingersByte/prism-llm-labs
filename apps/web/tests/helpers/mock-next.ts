/**
 * Next.js request/response helpers for API route tests.
 */
import { NextRequest } from "next/server";

export function makeRequest(
  url: string,
  options: {
    method?:  "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
    body?:    unknown;
    headers?: Record<string, string>;
    searchParams?: Record<string, string>;
  } = {},
): NextRequest {
  const { method = "GET", body, headers = {}, searchParams = {} } = options;

  const fullUrl = new URL(url, "http://localhost");
  for (const [k, v] of Object.entries(searchParams)) {
    fullUrl.searchParams.set(k, v);
  }

  return new NextRequest(fullUrl.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

export function makeAuthRequest(
  url:   string,
  token: string,
  options: Parameters<typeof makeRequest>[1] = {},
): NextRequest {
  return makeRequest(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
}

export async function parseJsonResponse<T = unknown>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}
