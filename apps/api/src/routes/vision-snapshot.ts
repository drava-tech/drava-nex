import { Hono } from "hono";
import { requireAdmin } from "../middleware/auth.js";
import { fail } from "../lib/response.js";
import { getLatestSnapshot } from "../services/vision-snapshot-store.js";

export const visionSnapshotRouter = new Hono();
visionSnapshotRouter.use("*", requireAdmin);

// GET /api/vision-snapshot/:cameraId — latest debug JPEG (boxes drawn), or 404
// once stale (pipeline not running / hasn't posted in the last 30s).
visionSnapshotRouter.get("/:cameraId", (c) => {
  const snap = getLatestSnapshot(c.req.param("cameraId"));
  if (!snap) return fail(c, "NO_SNAPSHOT", "No recent snapshot for this camera.", 404);

  return new Response(new Uint8Array(snap.buffer), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store",
    },
  });
});
