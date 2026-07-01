import { Hono } from "hono";
import { z } from "zod";
import { listDevices, getDevice, upsertDevice, setDeviceState } from "@platform/db";
import { requireApiClient } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";
import { getDeviceDriver } from "../services/devices.js";
import { broadcastToUe } from "../ws/gateway.js";

export const devicesRouter = new Hono();

const lightSchema = z.object({
  on: z.boolean(),
  brightness: z.number().min(0).max(100).optional(),
  color: z.string().optional(),
});

const upsertSchema = z.object({
  deviceId: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
});

// GET /api/devices — list registered devices (read scope or admin session)
devicesRouter.get("/", requireApiClient(["devices:read"]), async (c) => {
  return ok(c, await listDevices());
});

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

  broadcastToUe({
    type: "LIGHT_STATE_CHANGED",
    deviceId: device.deviceId,
    state: updated.state,
    timestamp: Date.now(),
  });
  return ok(c, updated);
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
