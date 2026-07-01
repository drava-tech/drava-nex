import "server-only";
import { headers } from "next/headers";

/**
 * Shared server-side client for the Hono API. Every CMS server action that
 * mutates platform state forwards the caller's auth cookie to the API so the
 * same admin session is enforced there — the API is the single source of truth,
 * the CMS is pure UI. (Reads in Server Components may still hit @platform/db
 * directly; this is for the write path that UE/mobile/IoT also use.)
 */

const API_BASE = process.env["INTERNAL_API_URL"] ?? "http://localhost:4000";

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: ApiError };

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const cookie = (await headers()).get("cookie") ?? "";
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        cookie,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      status: 0,
      error: { code: "NETWORK", message: "Could not reach the API service." },
    };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty / non-JSON body */
  }

  if (!res.ok) {
    const err = (body as { error?: ApiError } | null)?.error;
    return {
      ok: false,
      status: res.status,
      error: err ?? { code: "HTTP_ERROR", message: `Request failed (${res.status}).` },
    };
  }

  return { ok: true, data: (body as { data: T } | null)?.data as T };
}
