import { Hono } from "hono";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { recordDoorEvent, listDoorEvents } = vi.hoisted(() => ({
  recordDoorEvent: vi.fn(),
  listDoorEvents: vi.fn(),
}));

const { requireAdmin } = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockImplementation(async (c, next) => {
    await next();
  }),
}));

const { broadcastToCms } = vi.hoisted(() => ({
  broadcastToCms: vi.fn(),
}));

const { setHomeAssistantLockState, getHomeAssistantLockState } = vi.hoisted(() => ({
  setHomeAssistantLockState: vi.fn().mockResolvedValue(undefined),
  getHomeAssistantLockState: vi.fn(),
}));

vi.mock("@platform/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@platform/db")>();
  return {
    ...actual,
    recordDoorEvent,
    listDoorEvents,
  };
});

vi.mock("../src/middleware/auth.js", () => ({
  requireAdmin,
}));

vi.mock("../src/ws/gateway.js", () => ({
  broadcastToCms,
}));

vi.mock("../src/services/home-assistant.js", () => ({
  setHomeAssistantLockState,
  getHomeAssistantLockState,
  HomeAssistantError: class HomeAssistantError extends Error {},
}));

import { createDoorEventsRouter } from "../src/routes/door-events.js";

describe("POST /api/door-events/toggle", () => {
  let mockMqtt: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMqtt = {
      publishRaw: vi.fn().mockResolvedValue(undefined),
    };
    process.env["HA_ENTITY_ID"] = "lock.test_entity";
  });

  it("toggles the door lock state to unlocked", async () => {
    recordDoorEvent.mockResolvedValue({
      id: "event-id-123",
      lockId: "lock.test_entity",
      action: "unlocked",
      createdAt: new Date(),
    });
    listDoorEvents.mockResolvedValue({ total: 1 });

    const app = new Hono().route("/api/door-events", createDoorEventsRouter(mockMqtt));
    const res = await app.request("/api/door-events/toggle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "unlocked" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.success).toBe(true);

    expect(setHomeAssistantLockState).toHaveBeenCalledWith("unlocked");
    expect(mockMqtt.publishRaw).toHaveBeenCalledWith(
      "cms/door/lock.test_entity/unlocked",
      "true",
      { qos: 1, retain: true }
    );
    expect(recordDoorEvent).toHaveBeenCalledWith("lock.test_entity", "unlocked");
    expect(broadcastToCms).toHaveBeenCalled();
  });

  it("toggles the door lock state to locked", async () => {
    recordDoorEvent.mockResolvedValue({
      id: "event-id-456",
      lockId: "lock.test_entity",
      action: "locked",
      createdAt: new Date(),
    });
    listDoorEvents.mockResolvedValue({ total: 2 });

    const app = new Hono().route("/api/door-events", createDoorEventsRouter(mockMqtt));
    const res = await app.request("/api/door-events/toggle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "locked" }),
    });

    expect(res.status).toBe(200);
    expect(mockMqtt.publishRaw).toHaveBeenCalledWith(
      "cms/door/lock.test_entity/unlocked",
      "false",
      { qos: 1, retain: true }
    );
  });

  it("returns 502 and skips MQTT/DB when Home Assistant call fails", async () => {
    setHomeAssistantLockState.mockRejectedValueOnce(new Error("HA unreachable"));

    const app = new Hono().route("/api/door-events", createDoorEventsRouter(mockMqtt));
    const res = await app.request("/api/door-events/toggle", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "unlocked" }),
    });

    expect(res.status).toBe(502);
    expect(mockMqtt.publishRaw).not.toHaveBeenCalled();
    expect(recordDoorEvent).not.toHaveBeenCalled();
  });
});

describe("GET /api/door-events/state", () => {
  let mockMqtt: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMqtt = { publishRaw: vi.fn().mockResolvedValue(undefined) };
  });

  it("returns the live state from Home Assistant", async () => {
    getHomeAssistantLockState.mockResolvedValue({
      state: "locked",
      changedBy: "Auto Lock",
      lastChanged: "2026-07-18T06:57:44.342022+00:00",
    });

    const app = new Hono().route("/api/door-events", createDoorEventsRouter(mockMqtt));
    const res = await app.request("/api/door-events/state");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      state: "locked",
      changedBy: "Auto Lock",
      lastChanged: "2026-07-18T06:57:44.342022+00:00",
    });
  });

  it("returns 502 when Home Assistant is unreachable", async () => {
    getHomeAssistantLockState.mockRejectedValue(new Error("HA unreachable"));

    const app = new Hono().route("/api/door-events", createDoorEventsRouter(mockMqtt));
    const res = await app.request("/api/door-events/state");

    expect(res.status).toBe(502);
  });
});
