import type { Context } from "hono"
import type { z } from "zod"

import { fail } from "./response"

type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response }

/**
 * Parses and validates a JSON body. On failure the caller returns `response`
 * as-is — a 400 in the standard envelope with the zod issues attached.
 */
export async function parseJson<S extends z.ZodType>(
  c: Context,
  schema: S
): Promise<Parsed<z.infer<S>>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return { ok: false, response: fail(c, "VALIDATION", "Body must be valid JSON", 400) }
  }
  const result = schema.safeParse(body)
  if (!result.success) {
    const first = result.error.issues[0]?.message ?? "Invalid request body"
    return { ok: false, response: fail(c, "VALIDATION", first, 400, result.error.issues) }
  }
  return { ok: true, data: result.data }
}

/** Same, for query strings. */
export function parseQuery<S extends z.ZodType>(c: Context, schema: S): Parsed<z.infer<S>> {
  const result = schema.safeParse(c.req.query())
  if (!result.success) {
    const first = result.error.issues[0]?.message ?? "Invalid query"
    return { ok: false, response: fail(c, "VALIDATION", first, 400, result.error.issues) }
  }
  return { ok: true, data: result.data }
}
