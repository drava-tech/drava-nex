import { Hono } from "hono";
import { z } from "zod";
import { IDLE_WS_CONTENT } from "@platform/types";
import {
  listScreens,
  createScreen,
  deleteScreen,
  setScreenExperience,
  setScreenMedia,
  setScreenMediaQueue,
  advanceScreenQueue,
  setScreenDefaultMedia,
  setScreenBlanked,
  screenExists,
  getRecentContentForScreen,
} from "@platform/db";
import { requireAdmin, requireGuestOrAdmin } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";
import { broadcast, broadcastToCms, sendCommandToScreen, setScreenBlankState, getConnectedScreenIds, resetScreenTakeover, clearTakeoverFlag, getLiveObjectRecognitionContent, setScreenWhiteboardDocument, getActiveWhiteboardDocuments, stopScreenWhiteboard } from "../ws/gateway.js";

import { getScreenContent } from "../lib/screen-content.js";
// Everything under /api/screens. The GET reads are public (unauthenticated display
// screens sync off them); mutations/commands are guarded per-route.
export const screensRouter = new Hono();

function param(c: Parameters<typeof ok>[0], name: string): string {
  return (c.req.param() as Record<string, string | undefined>)[name] ?? "";
}

// --- Reads (public; shapes kept as-is, consumed by screens + launcher) ---

// GET /api/screens — list all screens
screensRouter.get("/", async (c) => {
  return c.json({ screens: await listScreens() });
});

// GET /api/screens/active — currently-connected screen ids, plus which
// screens have a saved whiteboard being live-pushed to them right now (see
// setScreenWhiteboardDocument) so the /screens list's "Control" button can
// redirect straight into that same live session.
screensRouter.get("/active", (c) => {
  return c.json({ activeScreenIds: getConnectedScreenIds(), activeWhiteboards: getActiveWhiteboardDocuments() });
});

// GET /api/screens/:screenId/config — DB-authoritative content (sync on connect/reload)
screensRouter.get("/:screenId/config", async (c) => {
  const screenId = param(c, "screenId");
  const content = await getScreenContent(screenId);
  if (!content) return c.json({ content: null }, 404);
  return c.json({ screenId, content });
});

// GET /api/screens/:screenId/recent-content — up to 5 most-recently-pushed
// pieces of content (media or experience) for this screen, newest first
// (see recordScreenMediaPush/recordScreenExperiencePush). CMS-only surface,
// unlike the reads above.
screensRouter.get("/:screenId/recent-content", requireGuestOrAdmin, async (c) => {
  const screenId = param(c, "screenId");
  const items = await getRecentContentForScreen(screenId);
  c.header("Cache-Control", "no-store, no-cache, must-revalidate");
  return c.json({ items });
});

/** Push freshly-assigned content to screens, UE subscribers, and CMS tabs. */
export async function pushScreenContent(screenId: string) {
  // Whatever's about to render here replaces what's on screen now, so any
  // live whiteboard drawn over the OLD content is stale — leaving it up means
  // the push lands underneath an overlay nobody asked for, and the only way
  // out was closing the board by hand from the CMS. Centralized here (rather
  // than at each call site) so every current and future caller of this
  // function gets it automatically — /queue/navigate and /default-media used
  // to miss this until it was centralized.
  stopScreenWhiteboard(screenId);
  let content = await getScreenContent(screenId);
  if (content?.templateKey === "object-recognition") {
    // The DB row is never the live source of truth for this template (see
    // packages/ui/src/templates/object-recognition/content.ts) — a screen
    // freshly assigned this experience should show current reality, not the
    // stale/default DB snapshot, if a live detection has already happened.
    content = getLiveObjectRecognitionContent(screenId) ?? content;
  }
  // Nothing assigned (and no default media) — still broadcast so an
  // already-connected screen actually drops to the idle logo live, instead of
  // silently keeping whatever it was last showing until its next reconnect.
  const outgoing = content ?? IDLE_WS_CONTENT;
  broadcast({ screenId, content: outgoing, source: "cms" });
  broadcastToCms({ type: "SCREEN_UPDATED", screenId, content: outgoing, source: "cms" });
  return content ?? null;
}

// --- Create ---

const createSchema = z.object({ screenId: z.string().min(1), screenName: z.string().min(1) });

// POST /api/screens — create a screen
screensRouter.post("/", requireAdmin, async (c) => {
  let body;
  try {
    body = createSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  if (await screenExists(body.screenId)) {
    return fail(c, "DUPLICATE", `Screen ID "${body.screenId}" already exists.`, 409);
  }
  await createScreen(body.screenId, body.screenName);
  return ok(c, { screenId: body.screenId }, 201);
});

// --- Delete ---

// DELETE /api/screens/:id — soft-delete a screen
screensRouter.delete("/:id", requireAdmin, async (c) => {
  await deleteScreen(param(c, "id"));
  return ok(c, { deleted: true });
});

// --- Nested: actions ---

const assignExperienceSchema = z.object({ experienceId: z.string().min(1) });

// POST /api/screens/:id/experience — assign experience, then broadcast
screensRouter.post("/:id/experience", requireGuestOrAdmin, async (c) => {
  const screenId = param(c, "id");
  let body;
  try {
    body = assignExperienceSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  await setScreenExperience(screenId, body.experienceId);
  // An explicit assignment always wins over a stale product-detection
  // takeover — otherwise a takeover armed before this call keeps that old
  // camera state relevant to a screen the admin just repointed elsewhere.
  clearTakeoverFlag(screenId);
  // A fresh assignment should actually play, not stay behind a previous
  // "Stop" — updates the live (already-connected) screen immediately, on
  // top of the DB write above which covers a later reconnect.
  setScreenBlankState(screenId, false);
  // Stale-whiteboard cleanup lives in pushScreenContent() now — see there.
  const content = await pushScreenContent(screenId);
  return ok(c, { screenId, content });
});

const assignMediaSchema = z.object({ mediaAssetId: z.string().min(1).nullable() });

// POST /api/screens/:id/media — assign a media asset, or clear with null to fall
// back to the screen's default/idle media, then broadcast
screensRouter.post("/:id/media", requireGuestOrAdmin, async (c) => {
  const screenId = param(c, "id");
  let body;
  try {
    body = assignMediaSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  await setScreenMedia(screenId, body.mediaAssetId);
  clearTakeoverFlag(screenId);
  setScreenBlankState(screenId, false);
  const content = await pushScreenContent(screenId);
  return ok(c, { screenId, content });
});

const assignMediaQueueSchema = z.object({
  mediaAssetIds: z.array(z.string().min(1)).min(1),
  startIndex: z.number().int().min(0).optional(),
});

// POST /api/screens/:id/media-queue — start (or replace) an ordered
// multi-item queue: currentMediaAssetId becomes the item at startIndex, same
// broadcast path as /media — the display side never knows a queue is involved.
screensRouter.post("/:id/media-queue", requireGuestOrAdmin, async (c) => {
  const screenId = param(c, "id");
  let body;
  try {
    body = assignMediaQueueSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  await setScreenMediaQueue(screenId, body.mediaAssetIds, body.startIndex ?? 0);
  clearTakeoverFlag(screenId);
  setScreenBlankState(screenId, false);
  const content = await pushScreenContent(screenId);
  return ok(c, { screenId, content });
});

const queueNavigateSchema = z.object({ direction: z.enum(["next", "prev"]) });

// POST /api/screens/:id/queue/navigate — step the active queue one item,
// clamped at the ends, and broadcast the new current item.
screensRouter.post("/:id/queue/navigate", requireGuestOrAdmin, async (c) => {
  const screenId = param(c, "id");
  let body;
  try {
    body = queueNavigateSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  const result = await advanceScreenQueue(screenId, body.direction);
  if (!result) return fail(c, "NOT_FOUND", "This screen has no active queue.", 404);
  clearTakeoverFlag(screenId);
  const content = await pushScreenContent(screenId);
  return ok(c, { screenId, content, queueIndex: result.index, queueLength: result.length });
});

const assignDefaultMediaSchema = z.object({ mediaAssetId: z.string().min(1).nullable() });

// POST /api/screens/:id/default-media — set (or clear) the screen's fallback
// video/image, shown when nothing is currently assigned. Re-pushes content in
// case the screen is idle right now, so the new default takes effect live.
screensRouter.post("/:id/default-media", requireGuestOrAdmin, async (c) => {
  const screenId = param(c, "id");
  let body;
  try {
    body = assignDefaultMediaSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  await setScreenDefaultMedia(screenId, body.mediaAssetId);
  clearTakeoverFlag(screenId);
  const content = await pushScreenContent(screenId);
  return ok(c, { screenId, content });
});

const blankSchema = z.object({ blanked: z.boolean() });

// POST /api/screens/:id/blank — stop (full-black overlay) or resume a screen.
// Persists to the screen row (so a reconnect stays black) and pushes the
// SCREEN_BLANK/SCREEN_UNBLANK command live.
screensRouter.post("/:id/blank", requireGuestOrAdmin, async (c) => {
  const screenId = param(c, "id");
  let body;
  try {
    body = blankSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  await setScreenBlanked(screenId, body.blanked);
  setScreenBlankState(screenId, body.blanked);
  return ok(c, { screenId, blanked: body.blanked });
});

const whiteboardSessionSchema = z.object({ documentId: z.string().min(1).nullable() });

// POST /api/screens/:id/whiteboard-session — record (or clear, with null)
// which saved whiteboard a CMS operator is live-pushing to this screen.
// In-memory only (see getActiveWhiteboardDocuments) — called by
// /whiteboards/[id]/live/[deviceId] on start/stop, read by the /screens
// list's "Control" button to redirect back into the same live session.
screensRouter.post("/:id/whiteboard-session", requireGuestOrAdmin, async (c) => {
  const screenId = param(c, "id");
  let body;
  try {
    body = whiteboardSessionSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  setScreenWhiteboardDocument(screenId, body.documentId);
  return ok(c, { screenId, documentId: body.documentId });
});

const commandSchema = z.object({ command: z.string().min(1), value: z.unknown().optional() });

// POST /api/screens/:id/command — remote command (CMS humans, guest or admin).
screensRouter.post(
  "/:id/command",
  requireGuestOrAdmin,
  async (c) => {
    const screenId = param(c, "id");
    let body;
    try {
      body = commandSchema.parse(await c.req.json());
    } catch (err) {
      return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
    }
    const delivered = sendCommandToScreen(screenId, body.command, body.value);
    return ok(c, { delivered });
  }
);

// POST /api/screens/:screenId/reset-detection — manually clear takeover content
screensRouter.post("/:screenId/reset-detection", requireAdmin, async (c) => {
  const screenId = param(c, "screenId");
  const cleared = await resetScreenTakeover(screenId);
  return ok(c, { cleared });
});
