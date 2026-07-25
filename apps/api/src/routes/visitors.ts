import { Hono } from "hono";
import type { Context } from "hono";
import {
  listVisitors,
  getVisitorImage,
  listVisitorPhotos,
  getVisitorPhoto,
  deleteVisitorPhoto,
  updateVisitorContact,
  mergeVisitor,
  VisitorNotFoundError,
  InvalidVisitorMergeError,
  type VisitorRow,
} from "@platform/db";
import {
  listVisitorsQuerySchema,
  updateVisitorSchema,
  mergeVisitorSchema,
  formatZodError,
  type VisitorListItem,
} from "@platform/types";
import { requireAdmin } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getUuidParam(c: Context): string | null {
  const raw = (c.req.param() as Record<string, string | undefined>)["uuid"] ?? "";
  return UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

function toItem(row: VisitorRow): VisitorListItem {
  return {
    uuid: row.uuid,
    name: row.name,
    email: row.email,
    role: row.role,
    hasImage: row.imagePath !== null,
    firstSeen: row.firstSeen.toISOString(),
    lastSeen: row.lastSeen.toISOString(),
  };
}

export const visitorsRouter = new Hono();

visitorsRouter.use("*", requireAdmin);

// GET /api/visitors — paginated list, newest last_seen first
visitorsRouter.get("/", async (c) => {
  const parsed = listVisitorsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return fail(c, "VALIDATION", "Invalid query.", 422, formatZodError(parsed.error));
  }
  try {
    const result = await listVisitors(parsed.data);
    return ok(c, { ...result, items: result.items.map(toItem) });
  } catch (err) {
    console.error("[visitors] unhandled error:", err);
    return fail(c, "INTERNAL", "Something went wrong.", 500);
  }
});

// PATCH /api/visitors/:uuid — staff assigns name/email (role is never accepted)
visitorsRouter.patch("/:uuid", async (c) => {
  const uuid = getUuidParam(c);
  if (!uuid) return fail(c, "VALIDATION", "Invalid visitor id.", 422);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return fail(c, "INVALID_BODY", "Request body must be valid JSON.", 422);
  }
  const parsed = updateVisitorSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(c, "VALIDATION", "Validation failed.", 422, formatZodError(parsed.error));
  }

  try {
    return ok(c, toItem(await updateVisitorContact(uuid, parsed.data)));
  } catch (err) {
    if (err instanceof VisitorNotFoundError) {
      return fail(c, "NOT_FOUND", err.message, 404);
    }
    console.error("[visitors] unhandled error:", err);
    return fail(c, "INTERNAL", "Something went wrong.", 500);
  }
});

// POST /api/visitors/:uuid/merge — fold a duplicate identity into the target
visitorsRouter.post("/:uuid/merge", async (c) => {
  const uuid = getUuidParam(c);
  if (!uuid) return fail(c, "VALIDATION", "Invalid visitor id.", 422);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return fail(c, "INVALID_BODY", "Request body must be valid JSON.", 422);
  }
  const parsed = mergeVisitorSchema.safeParse(raw);
  if (!parsed.success) {
    return fail(c, "VALIDATION", "Validation failed.", 422, formatZodError(parsed.error));
  }

  try {
    return ok(c, toItem(await mergeVisitor(uuid, parsed.data.targetUuid)));
  } catch (err) {
    if (err instanceof InvalidVisitorMergeError) {
      return fail(c, "VALIDATION", err.message, 422);
    }
    if (err instanceof VisitorNotFoundError) {
      return fail(c, "NOT_FOUND", err.message, 404);
    }
    console.error("[visitors] unhandled error:", err);
    return fail(c, "INTERNAL", "Something went wrong.", 500);
  }
});

// GET /api/visitors/:uuid/image — the face crop, served from the database.
// The JPEG bytes live in Postgres (visitor.image_bytes); still streamed
// through this admin-authenticated route, never exposed as a static file, as
// biometric PII. 404 once the image has been purged (bytes set to NULL).
visitorsRouter.get("/:uuid/image", async (c) => {
  const uuid = getUuidParam(c);
  if (!uuid) return fail(c, "VALIDATION", "Invalid visitor id.", 422);

  try {
    const bytes = await getVisitorImage(uuid);
    if (!bytes) return fail(c, "NO_IMAGE", "Image not found.", 404);

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error("[visitors] unhandled error:", err);
    return fail(c, "INTERNAL", "Something went wrong.", 500);
  }
});

function getPhotoNumber(c: Context): number | null {
  const raw = (c.req.param() as Record<string, string | undefined>)["n"] ?? "";
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /api/visitors/:uuid/photos — the visitor's captured crops' photo_numbers
visitorsRouter.get("/:uuid/photos", async (c) => {
  const uuid = getUuidParam(c);
  if (!uuid) return fail(c, "VALIDATION", "Invalid visitor id.", 422);
  try {
    return ok(c, { photos: await listVisitorPhotos(uuid) });
  } catch (err) {
    console.error("[visitors] unhandled error:", err);
    return fail(c, "INTERNAL", "Something went wrong.", 500);
  }
});

// GET /api/visitors/:uuid/photos/:n/image — one captured crop, from the DB
visitorsRouter.get("/:uuid/photos/:n/image", async (c) => {
  const uuid = getUuidParam(c);
  const n = getPhotoNumber(c);
  if (!uuid || n === null) return fail(c, "VALIDATION", "Invalid request.", 422);
  try {
    const bytes = await getVisitorPhoto(uuid, n);
    if (!bytes) return fail(c, "NO_IMAGE", "Image not found.", 404);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error("[visitors] unhandled error:", err);
    return fail(c, "INTERNAL", "Something went wrong.", 500);
  }
});

// DELETE /api/visitors/:uuid/photos/:n — remove a bad/wrong crop (+ its sample)
visitorsRouter.delete("/:uuid/photos/:n", async (c) => {
  const uuid = getUuidParam(c);
  const n = getPhotoNumber(c);
  if (!uuid || n === null) return fail(c, "VALIDATION", "Invalid request.", 422);
  try {
    await deleteVisitorPhoto(uuid, n);
    return ok(c, { deleted: n });
  } catch (err) {
    console.error("[visitors] unhandled error:", err);
    return fail(c, "INTERNAL", "Something went wrong.", 500);
  }
});
