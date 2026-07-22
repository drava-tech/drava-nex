import { Hono } from "hono";
import { z } from "zod";
import { listDevices, getDevice, upsertDevice, setDeviceState } from "@platform/db";
import { requireApiClient } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";
import { getDeviceDriver, getIrDriver } from "../services/devices.js";
import { broadcastToCms, broadcastToUe } from "../ws/gateway.js";

export const devicesRouter = new Hono();

const lightSchema = z.object({
  on: z.boolean(),
  brightness: z.number().min(0).max(100).optional(),
  color: z.string().optional(),
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

// GET /api/devices — list registered devices (read scope or admin session)
devicesRouter.get("/", requireApiClient(["devices:read"]), async (c) => {
  return ok(c, await listDevices());
});

// GET /api/devices/:id/status
devicesRouter.get("/:id/status", requireApiClient(["devices:read"]), async (c) => {
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

// POST /api/devices — register/upsert a device (write scope or admin)
devicesRouter.post("/", requireApiClient(["devices:write"]), async (c) => {
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
devicesRouter.post("/lights/:id/state", requireApiClient(["devices:write"]), async (c) => {
  const device = await getDevice(c.req.param("id") ?? "");
  if (!device) return fail(c, "NOT_FOUND", "Device not found", 404);

  let body;
  try {
    body = lightSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, "VALIDATION", "Invalid request body", 400, (err as z.ZodError).issues);
  }

  await getDeviceDriver(device).setLightState(device, body);
  const updated = await setDeviceState(device.id, { ...(device.state ?? {}), ...body });

  broadcastToCms({ type: "LIGHT_STATE_UPDATE", deviceId: device.deviceId, state: updated.state });
  broadcastToUe({
    type: "LIGHT_STATE_CHANGED",
    deviceId: device.deviceId,
    state: updated.state,
    timestamp: Date.now(),
  });
  return ok(c, updated);
});

// POST /api/devices/lights/:id/identify — briefly flash the light so it can be
// visually identified (see DeviceDriver.identify, e.g. CasambiDeviceDriver).
devicesRouter.post("/lights/:id/identify", requireApiClient(["devices:write"]), async (c) => {
  const device = await getDevice(c.req.param("id") ?? "");
  if (!device) return fail(c, "NOT_FOUND", "Device not found", 404);

  const driver = getDeviceDriver(device);
  if (!driver.identify) return fail(c, "UNSUPPORTED", "This device's driver does not support identify", 400);

  await driver.identify(device);
  return ok(c, { identified: true });
});

// POST /api/devices/scenes/:id/trigger
devicesRouter.post("/scenes/:id/trigger", requireApiClient(["devices:write"]), async (c) => {
  const device = await getDevice(c.req.param("id") ?? "");
  if (!device) return fail(c, "NOT_FOUND", "Device not found", 404);

  await getDeviceDriver(device).triggerScene(device);
  broadcastToUe({
    type: "DEVICE_STATUS_CHANGED",
    deviceId: device.deviceId,
    status: "scene_triggered",
    timestamp: Date.now(),
  });
  return ok(c, { triggered: true });
});

// POST /api/devices/ir/:id/command — { command, params? }
// Sends one IR command (AC verb or codebook key) to the CrabController bridge
// over MQTT, persists the AC's derived state, and echoes to CMS/UE.
devicesRouter.post("/ir/:id/command", requireApiClient(["devices:write"]), async (c) => {
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

  await driver.sendCommand(device, body);
  const nextState = applyIrCommandToState(device.state ?? {}, body.command, body.params);
  const updated = await setDeviceState(device.id, nextState);

  broadcastToCms({ type: "IR_STATE_UPDATE", deviceId: device.deviceId, state: updated.state });
  broadcastToUe({
    type: "DEVICE_STATUS_CHANGED",
    deviceId: device.deviceId,
    status: `ir:${body.command}`,
    timestamp: Date.now(),
  });
  return ok(c, updated);
});
