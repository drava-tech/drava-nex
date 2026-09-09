import { Hono } from "hono";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { stopScreenWhiteboard } = vi.hoisted(() => ({ stopScreenWhiteboard: vi.fn() }));

vi.mock("@platform/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@platform/db")>();
  return {
    ...actual,
    getScreenContent: vi.fn().mockResolvedValue(null),
    setScreenExperience: vi.fn(),
    setScreenMedia: vi.fn(),
    setScreenMediaQueue: vi.fn(),
  };
});
vi.mock("../src/middleware/auth.js", () => ({
  requireAdmin: vi.fn(async (_c: unknown, next: () => Promise<void>) => next()),
  requireGuestOrAdmin: vi.fn(async (_c: unknown, next: () => Promise<void>) => next()),
}));
vi.mock("../src/ws/gateway.js", () => ({
  stopScreenWhiteboard,
  broadcast: vi.fn(),
  broadcastToCms: vi.fn(),
  sendCommandToScreen: vi.fn(),
  setScreenBlankState: vi.fn(),
  getConnectedScreenIds: vi.fn(() => []),
  getConnectedPlayerCount: vi.fn(() => 1),
  resetScreenTakeover: vi.fn(),
  clearTakeoverFlag: vi.fn(),
  getLiveObjectRecognitionContent: vi.fn(() => null),
  setScreenWhiteboardDocument: vi.fn(),
  getActiveWhiteboardDocuments: vi.fn(() => []),
}));

import { screensRouter } from "../src/routes/screens.js";

const post = (path: string, body: unknown) =>
  new Hono().route("/api/screens", screensRouter).request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// A live whiteboard is drawn over whatever was on the screen at the time, so
// pushing NEW content has to tear it down — otherwise the push lands
// underneath a stale overlay and the only way out is closing it by hand.
describe("pushing content clears a live whiteboard overlay", () => {
  beforeEach(() => stopScreenWhiteboard.mockReset());

  it("stops it when an experience is assigned", async () => {
    const res = await post("/api/screens/main-screen/experience", { experienceId: "exp-1" });
    expect(res.status).toBe(200);
    expect(stopScreenWhiteboard).toHaveBeenCalledWith("main-screen");
  });

  it("stops it when a media asset is assigned", async () => {
    const res = await post("/api/screens/main-screen/media", { mediaAssetId: "media-1" });
    expect(res.status).toBe(200);
    expect(stopScreenWhiteboard).toHaveBeenCalledWith("main-screen");
  });

  it("stops it on a reset to idle (null media) too", async () => {
    const res = await post("/api/screens/main-screen/media", { mediaAssetId: null });
    expect(res.status).toBe(200);
    expect(stopScreenWhiteboard).toHaveBeenCalledWith("main-screen");
  });

  it("stops it when a media queue is started", async () => {
    const res = await post("/api/screens/main-screen/media-queue", { mediaAssetIds: ["m1", "m2"] });
    expect(res.status).toBe(200);
    expect(stopScreenWhiteboard).toHaveBeenCalledWith("main-screen");
  });
});
