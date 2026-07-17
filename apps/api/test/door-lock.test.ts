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

import { createDoorEventsRouter } from "../src/routes/door-events.js";

describe("POST /api/door-events/toggle", () => {
  let mockMqtt: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMqtt = {
      publishRaw: vi.fn().mockResolvedValue(undefined),
    };
    process.env["YALE_LOCK_ID"] = "TEST_LOCK_123";
  });

  it("toggles the door lock state to unlocked", async () => {
    recordDoorEvent.mockResolvedValue({
      id: "event-id-123",
      lockId: "TEST_LOCK_123",
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

    expect(mockMqtt.publishRaw).toHaveBeenCalledWith(
      "cms/door/TEST_LOCK_123/unlocked",
      "true",
      { qos: 1, retain: true }
    );
    expect(recordDoorEvent).toHaveBeenCalledWith("TEST_LOCK_123", "unlocked");
    expect(broadcastToCms).toHaveBeenCalled();
  });

  it("toggles the door lock state to locked", async () => {
    recordDoorEvent.mockResolvedValue({
      id: "event-id-456",
      lockId: "TEST_LOCK_123",
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
      "cms/door/TEST_LOCK_123/unlocked",
      "false",
      { qos: 1, retain: true }
    );
  });
});
