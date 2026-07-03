import { Hono } from "hono";
import { z } from "zod";
import {
  listScreens,
  createScreen,
  deleteScreen,
  setScreenExperience,
  setScreenMedia,
  getScreenContent,
  screenExists,
} from "@platform/db";
import { requireAdmin, requireGuestOrAdmin, requireApiClient } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";
import { broadcast, broadcastToCms, sendCommandToScreen, getConnectedScreenIds, resetScreenTakeover } from "../ws/gateway.js";

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
  const content = await getScreenContent(screenId);
  if (!content) return c.json({ content: null }, 404);
  return c.json({ screenId, content });
});

/** Push freshly-assigned content to screens, UE subscribers, and CMS tabs. */
async function pushScreenContent(screenId: string) {
  const content = await getScreenContent(screenId);
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
  const content = await pushScreenContent(screenId);
  return ok(c, { screenId, content });
});

const assignMediaSchema = z.object({ mediaAssetId: z.string().min(1) });

// POST /api/screens/:id/media — assign a media asset, then broadcast
screensRouter.post("/:id/media", requireGuestOrAdmin, async (c) => {
  const screenId = param(c, "id");
  let body;
  try {
    body = assignMediaSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  await setScreenMedia(screenId, body.mediaAssetId);
  const content = await pushScreenContent(screenId);
  return ok(c, { screenId, content });
});

const commandSchema = z.object({ command: z.string().min(1), value: z.unknown().optional() });

// POST /api/screens/:id/command — remote command. CMS humans (guest/admin) OR a
// machine client (Unreal Engine) with the "screens:command" scope.
screensRouter.post(
  "/:id/command",
  requireApiClient(["screens:command"], { allowGuest: true }),
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
