import { Hono } from "hono";
import { z } from "zod";
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
  setScreenInteractionEnabled,
  getScreenInteractionEnabled,
  getScreenContent,
  screenExists,
} from "@platform/db";
import { requireAdmin, requireGuestOrAdmin } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";
import { broadcast, broadcastToCms, sendCommandToScreen, setScreenBlankState, setScreenInteractionState, getConnectedScreenIds, resetScreenTakeover, clearTakeoverFlag, getLiveObjectRecognitionContent } from "../ws/gateway.js";

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

// GET /api/screens/active — currently-connected screen ids
screensRouter.get("/active", (c) => {
  return c.json({ activeScreenIds: getConnectedScreenIds() });
});

// GET /api/screens/:screenId/config — DB-authoritative content (sync on connect/reload)
screensRouter.get("/:screenId/config", async (c) => {
  const screenId = param(c, "screenId");
  const [content, interactionEnabled] = await Promise.all([
    getScreenContent(screenId),
    getScreenInteractionEnabled(screenId),
  ]);
  if (!content) return c.json({ content: null, interactionEnabled }, 404);
  return c.json({ screenId, content, interactionEnabled });
});

/** Push freshly-assigned content to screens, UE subscribers, and CMS tabs. */
export async function pushScreenContent(screenId: string) {
  let content = await getScreenContent(screenId);
  if (content?.templateKey === "object-recognition") {
    // The DB row is never the live source of truth for this template (see
    // packages/ui/src/templates/object-recognition/content.ts) — a screen
    // freshly assigned this experience should show current reality, not the
    // stale/default DB snapshot, if a live detection has already happened.
    content = getLiveObjectRecognitionContent(screenId) ?? content;
  }
  if (content) {
    broadcast({ screenId, content, source: "cms" });
    broadcastToCms({ type: "SCREEN_UPDATED", screenId, content, source: "cms" });
  }
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

const interactionSchema = z.object({ enabled: z.boolean() });

// POST /api/screens/:id/interaction — enable/disable click/scroll/type
// everywhere this screen is rendered (its own TV AND any CMS mirror/popup).
screensRouter.post("/:id/interaction", requireGuestOrAdmin, async (c) => {
  const screenId = param(c, "id");
  let body;
  try {
    body = interactionSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  await setScreenInteractionEnabled(screenId, body.enabled);
  setScreenInteractionState(screenId, body.enabled);
  return ok(c, { screenId, interactionEnabled: body.enabled });
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
