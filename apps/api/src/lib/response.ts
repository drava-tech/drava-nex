import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/**
 * Consistent API envelope: `{ success: true, data }` on success, and
 * `{ success: false, error: { code, message, details? } }` on failure. Internal
 * database errors are never leaked to the client.
 */

export function ok<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
  return c.json({ success: true, data }, status);
}

export function fail(
  c: Context,
  code: string,
  message: string,
  status: ContentfulStatusCode = 400,
  details?: unknown
) {
  return c.json(
    { success: false, error: { code, message, ...(details !== undefined ? { details } : {}) } },
    status
  );
}

/**
 * Map a Postgres unique-violation (23505) to the offending logical field, so the
 * route can return a friendly 409 instead of a 500.
 */
export function uniqueViolationField(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { code?: string; constraint?: string; detail?: string };
  if (e.code !== "23505") return null;
  const hay = `${e.constraint ?? ""} ${e.detail ?? ""}`;
  if (hay.includes("detection_label")) return "detectionLabel";
  if (hay.includes("sku")) return "sku";
  if (hay.includes("slug")) return "slug";
  if (hay.includes("product_media")) return "media";
  return "value";
}
