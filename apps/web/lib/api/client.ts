/**
 * Typed fetch client for first-party API routes. Client-side oriented (used by
 * react-query in widgets); relative paths resolve against the current origin.
 * Server Components should call the Tinybird/Supabase query functions directly
 * rather than round-tripping through HTTP.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  params?: Record<string, string | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

function origin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(path, origin());
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
    credentials: "same-origin",
  });

  const text = await res.text();
  const json = text ? safeParse(text) : null;

  if (!res.ok) {
    const message =
      json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, json);
  }

  return json as T;
}

export const apiGet = <T>(path: string, params?: Record<string, string | undefined>, signal?: AbortSignal) =>
  request<T>("GET", path, { params, signal });

export const apiPost = <T>(path: string, body?: unknown, signal?: AbortSignal) =>
  request<T>("POST", path, { body, signal });

export const apiPut = <T>(path: string, body?: unknown, signal?: AbortSignal) =>
  request<T>("PUT", path, { body, signal });

export const apiPatch = <T>(path: string, body?: unknown, signal?: AbortSignal) =>
  request<T>("PATCH", path, { body, signal });

export const apiDelete = <T>(path: string, signal?: AbortSignal) =>
  request<T>("DELETE", path, { signal });
