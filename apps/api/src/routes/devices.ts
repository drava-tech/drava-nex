import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { listDevices, getDevice, upsertDevice, setDeviceState, type Device } from "@platform/db";
import { requireAdmin } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";
import { getDeviceDriver, getIrDriver, getCasambiDriver } from "../services/devices.js";
import { broadcastToCms } from "../ws/gateway.js";

export const devicesRouter = new Hono();

const lightSchema = z.object({
  on: z.boolean(),
  brightness: z.number().min(0).max(100).optional(),
  color: z.string().optional(),
});

type LightStateInput = z.infer<typeof lightSchema>;

/**
 * Drive one light's real hardware, persist the resulting state, and tell
 * both the CMS and UE about it. Shared by POST /lights/:id/state (one light)
 * and the scene-trigger branch below (fans this out over every target).
 */
async function applyLightState(device: Device, state: LightStateInput) {
  await getDeviceDriver(device).setLightState(device, state);
  const updated = await setDeviceState(device.id, { ...(device.state ?? {}), ...state });
  broadcastToCms({ type: "LIGHT_STATE_UPDATE", deviceId: device.deviceId, state: updated.state });
  return updated;
}

const createModeSchema = z.object({
  name: z.string().min(1),
});

const irCommandSchema = z.object({
  command: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Fold a discrete IR command into the AC's persisted state so the Climate panel
 * rehydrates on reload. Mirrors CrabController's ACRemote: set_* also powers on.
 * Non-AC codebook keys (TV power, volume, …) are stateless — returns prev.
 */
function applyIrCommandToState(
  prev: Record<string, unknown>,
  command: string,
  params?: Record<string, unknown>
): Record<string, unknown> {
  switch (command) {
    case "power_on":
      return { ...prev, power: true };
    case "power_off":
      return { ...prev, power: false };
    case "set_temp":
      return { ...prev, power: true, temp: params?.["temp"] };
    case "set_mode":
      return { ...prev, power: true, mode: params?.["mode"] };
    case "set_fan":
      return { ...prev, power: true, fan: params?.["fan"] };
    default:
      return prev;
  }
}

const upsertSchema = z.object({
  deviceId: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
});

// --- Reads ---

// GET /api/devices — list registered devices
devicesRouter.get("/", requireAdmin, async (c) => {
  return ok(c, await listDevices());
});

// GET /api/devices/:id/status
devicesRouter.get("/:id/status", requireAdmin, async (c) => {
  const device = await getDevice(c.req.param("id") ?? "");
  if (!device) return fail(c, "NOT_FOUND", "Device not found", 404);
  return ok(c, {
    id: device.id,
    deviceId: device.deviceId,
    type: device.type,
    status: device.status,
    state: device.state,
    lastSeenAt: device.lastSeenAt,
  });
});

// --- Create ---

// POST /api/devices — register/upsert a device
devicesRouter.post("/", requireAdmin, async (c) => {
  let body;
  try {
    body = upsertSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }
  const device = await upsertDevice(body);
  return ok(c, device, 201);
});

// --- Nested: actions ---

// POST /api/devices/lights/:id/state — { on, brightness?, color? }
devicesRouter.post("/lights/:id/state", requireAdmin, async (c) => {
  const device = await getDevice(c.req.param("id") ?? "");
  if (!device) return fail(c, "NOT_FOUND", "Device not found", 404);

  let body: LightStateInput;
  try {
    body = lightSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }

  const updated = await applyLightState(device, body);
  return ok(c, updated);
});

// POST /api/devices/lights/casambi-scene — recall a scene defined in the
// Casambi network. Needed because a scene is the only thing that can change a
// fixture's White/Colour balance; no direct MQTT command does.
devicesRouter.post("/lights/casambi-scene", requireAdmin, async (c) => {
  let body: { scene: number; level?: number };
  try {
    body = z
      .object({ scene: z.number().int().min(1).max(255), level: z.number().int().min(0).max(255).optional() })
      .parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }

  const driver = getCasambiDriver();
  if (!driver) return fail(c, "UNSUPPORTED", "Casambi driver not configured", 400);

  await driver.triggerMeshScene(body.scene, body.level ?? 255);
  return ok(c, { recalled: body.scene });
});

// POST /api/devices/lights/:id/identify — briefly flash the light so it can be
// visually identified (see DeviceDriver.identify, e.g. CasambiDeviceDriver).
devicesRouter.post("/lights/:id/identify", requireAdmin, async (c) => {
  const device = await getDevice(c.req.param("id") ?? "");
  if (!device) return fail(c, "NOT_FOUND", "Device not found", 404);

  const driver = getDeviceDriver(device);
  if (!driver.identify) return fail(c, "UNSUPPORTED", "This device's driver does not support identify", 400);

  await driver.identify(device);
  return ok(c, { identified: true });
});

// POST /api/devices/scenes — capture every real light's CURRENT state (read
// from the DB, not the caller's belief of it) into a new named mode/preset.
devicesRouter.post("/scenes", requireAdmin, async (c) => {
  let body: z.infer<typeof createModeSchema>;
  try {
    body = createModeSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }

  const lights = (await listDevices()).filter(
    (d) => (d.config as { driver?: string } | null)?.driver === "casambi"
  );

  const targets: Record<string, LightStateInput> = {};
  for (const light of lights) {
    const state = light.state as { on?: boolean; brightness?: number; color?: string } | null;
    targets[light.id] = {
      on: Boolean(state?.on),
      ...(typeof state?.brightness === "number" ? { brightness: state.brightness } : {}),
      ...(typeof state?.color === "string" ? { color: state.color } : {}),
    };
  }

  const device = await upsertDevice({
    deviceId: `scene-${randomUUID()}`,
    type: "scene",
    name: body.name,
    config: { driver: "scene", targets },
  });
  return ok(c, device, 201);
});

// POST /api/devices/scenes/:id/trigger — apply every target's saved state.
devicesRouter.post("/scenes/:id/trigger", requireAdmin, async (c) => {
  const device = await getDevice(c.req.param("id") ?? "");
  if (!device) return fail(c, "NOT_FOUND", "Device not found", 404);

  const config = device.config as { driver?: string; targets?: Record<string, LightStateInput> } | null;
  if (config?.driver === "scene" && config.targets) {
    for (const [targetId, state] of Object.entries(config.targets)) {
      const target = await getDevice(targetId);
      if (!target) continue; // e.g. a retired/spare light referenced by an old preset — skip quietly
      await applyLightState(target, state);
    }
  } else {
    await getDeviceDriver(device).triggerScene(device);
  }

  return ok(c, { triggered: true });
});

// POST /api/devices/ir/:id/command — { command, params? }
// Sends one IR command (AC verb or codebook key) to the CrabController bridge
// over MQTT, persists the AC's derived state, and echoes to CMS.
devicesRouter.post("/ir/:id/command", requireAdmin, async (c) => {
  const device = await getDevice(c.req.param("id") ?? "");
  if (!device) return fail(c, "NOT_FOUND", "Device not found", 404);

  const driver = getIrDriver();
  if (!driver) return fail(c, "UNSUPPORTED", "IR driver not configured", 400);

  let body;
  try {
    body = irCommandSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }

  try {
    await driver.sendCommand(device, body);
  } catch (err: any) {
    return fail(c, "DRIVER_ERROR", err.message || "Device driver failed", 500);
  }
  const nextState = applyIrCommandToState(device.state ?? {}, body.command, body.params);
  const updated = await setDeviceState(device.id, nextState);

  broadcastToCms({ type: "IR_STATE_UPDATE", deviceId: device.deviceId, state: updated.state });
  return ok(c, updated);
});
