import type { ApiErrorCode, ApiResponse } from "@workspace/types"

/** A failed API call, carrying the server's error code for callers to branch on. */
export class ApiError extends Error {
  readonly code: ApiErrorCode | "NETWORK"
  readonly status: number
  readonly issues?: unknown

  constructor(code: ApiErrorCode | "NETWORK", message: string, status: number, issues?: unknown) {
    super(message)
    this.name = "ApiError"
    this.code = code
    this.status = status
    this.issues = issues
  }
}

/**
 * Calls a JSON route and unwraps the `{ success, data }` envelope. Throws an
 * ApiError for any failure, so TanStack Query's error state gets a real message.
 */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init
  let res: Response
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      ...rest,
      headers: {
        Accept: "application/json",
        ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    })
  } catch {
    throw new ApiError("NETWORK", "Can't reach the server. Check your connection.", 0)
  }

  let body: ApiResponse<T> | undefined
  try {
    body = (await res.json()) as ApiResponse<T>
  } catch {
    // Non-JSON (e.g. a proxy error page).
  }

  if (body?.success) return body.data
  if (body && !body.success) {
    throw new ApiError(body.error.code, body.error.message, res.status, body.error.issues)
  }
  throw new ApiError("INTERNAL", `Unexpected response (${res.status})`, res.status)
}
