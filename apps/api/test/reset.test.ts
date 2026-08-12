import { Hono } from "hono";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getScreenContent } = vi.hoisted(() => ({
  getScreenContent: vi.fn(),
}));
const { requireAdmin } = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockImplementation(async (c, next) => {
    await next();
  }),
}));
const { resetScreenTakeover } = vi.hoisted(() => ({
  resetScreenTakeover: vi.fn(),
}));

vi.mock("@platform/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@platform/db")>();
  return {
    ...actual,
    getScreenContent,
    listScreens: vi.fn(),
    createScreen: vi.fn(),
    deleteScreen: vi.fn(),
    setScreenExperience: vi.fn(),
    setScreenMedia: vi.fn(),
    screenExists: vi.fn(),
  };
});
vi.mock("../src/middleware/auth.js", () => ({
  requireAdmin,
  requireGuestOrAdmin: vi.fn().mockImplementation(async (c, next) => {
    await next();
  }),
}));
vi.mock("../src/ws/gateway.js", () => ({
  resetScreenTakeover,
  broadcast: vi.fn(),
  broadcastToCms: vi.fn(),
  sendCommandToScreen: vi.fn(),
  getConnectedScreenIds: vi.fn(),
}));

import { screensRouter } from "../src/routes/screens.js";

describe("POST /api/screens/:screenId/reset-detection", () => {
  beforeEach(() => {
    resetScreenTakeover.mockReset();
  });

  it("calls resetScreenTakeover and returns cleared: true on success", async () => {
    resetScreenTakeover.mockResolvedValue(true);
    
    const app = new Hono().route("/api/screens", screensRouter);
    const res = await app.request("/api/screens/main-screen/reset-detection", {
      method: "POST",
    });
    
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.cleared).toBe(true);
    expect(resetScreenTakeover).toHaveBeenCalledWith("main-screen");
  });
});
