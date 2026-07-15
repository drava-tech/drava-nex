import { Hono } from "hono";
import type { Context } from "hono";
import fs from "fs";
import path from "path";
import {
  listVisitors,
  getVisitorByUuid,
  updateVisitorContact,
  VisitorNotFoundError,
  type VisitorRow,
} from "@platform/db";
import {
  listVisitorsQuerySchema,
  updateVisitorSchema,
  formatZodError,
  type VisitorListItem,
} from "@platform/types";
import { requireAdmin } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";

// Face crops live where the face-vision service writes them (FACE_IMAGE_DIR
// in both processes). They are biometric PII, so they are streamed through
// this admin-authenticated route — never exposed as static files.
const FACE_IMAGE_DIR =
  process.env["FACE_IMAGE_DIR"] ??
  path.join(process.cwd(), "../../services/face-vision/data/faces");

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

// GET /api/visitors/:uuid/image — stream the face crop (404 once purged)
visitorsRouter.get("/:uuid/image", async (c) => {
  const uuid = getUuidParam(c);
  if (!uuid) return fail(c, "VALIDATION", "Invalid visitor id.", 422);

  try {
    const visitor = await getVisitorByUuid(uuid);
    if (!visitor) return fail(c, "NOT_FOUND", "Visitor not found.", 404);
    if (!visitor.imagePath) return fail(c, "NO_IMAGE", "Image has been purged.", 404);

    // Containment guard — imagePath is stored as a bare filename, but never
    // trust it: the resolved path must stay inside FACE_IMAGE_DIR.
    const baseDir = path.resolve(FACE_IMAGE_DIR);
    const resolved = path.resolve(baseDir, visitor.imagePath);
    if (resolved === baseDir || !resolved.startsWith(baseDir + path.sep)) {
      return fail(c, "FORBIDDEN", "Invalid image path.", 403);
    }
    if (!fs.existsSync(resolved)) {
      return fail(c, "NO_IMAGE", "Image file not found.", 404);
    }

    const stream = fs.createReadStream(resolved);
    return new Response(stream as unknown as ReadableStream, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(fs.statSync(resolved).size),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (err) {
    console.error("[visitors] unhandled error:", err);
    return fail(c, "INTERNAL", "Something went wrong.", 500);
  }
});
