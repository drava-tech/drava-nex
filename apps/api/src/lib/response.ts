import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { ApiErrorCode } from "@workspace/types"

/** `{ success: true, data }` — the envelope every JSON route answers with. */
export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ success: true as const, data }, status)
}

/** `{ success: false, error: { code, message, issues? } }` */
export function fail(
  c: Context,
  code: ApiErrorCode,
  message: string,
  status: ContentfulStatusCode,
  issues?: unknown
) {
  return c.json(
    { success: false as const, error: { code, message, ...(issues ? { issues } : {}) } },
    status
  )
}
