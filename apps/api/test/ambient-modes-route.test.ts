import { describe, it, expect, vi, beforeEach } from "vitest";

const { updateAmbientMode, getAmbientMode, listAmbientModes, applyAmbientMode } = vi.hoisted(() => ({
  updateAmbientMode: vi.fn(),
  getAmbientMode: vi.fn(),
  listAmbientModes: vi.fn(),
  applyAmbientMode: vi.fn(),
}));

vi.mock("@platform/db", () => ({ updateAmbientMode }));
vi.mock("../src/middleware/auth.js", () => ({
  requireAdmin: async (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock("../src/services/ambient-modes.js", () => ({ getAmbientMode, listAmbientModes, applyAmbientMode }));

import { ambientModesRouter } from "../src/routes/ambient-modes.js";

const put = (key: string, body: unknown) =>
  ambientModesRouter.request(`/${key}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("PUT /api/ambient-modes/:key", () => {
  it("saves a valid colour, brightness and strip setting (colour upper-cased)", async () => {
    updateAmbientMode.mockResolvedValue({ key: "meeting" });
    const res = await put("meeting", { color: "#100073", brightness: 15, stripOn: false });
    expect(res.status).toBe(200);
    expect(updateAmbientMode).toHaveBeenCalledWith("meeting", { color: "#100073", brightness: 15, stripOn: false });

    await put("meeting", { color: "#abcdef" });
    expect(updateAmbientMode).toHaveBeenLastCalledWith("meeting", { color: "#ABCDEF" });
  });

  it("rejects a bad colour or an out-of-range brightness without touching the database", async () => {
    for (const body of [{ color: "red" }, { color: "#FFF" }, { brightness: 101 }, { brightness: -1 }, { brightness: 12.5 }]) {
      expect((await put("meeting", body)).status).toBe(400);
    }
    expect(updateAmbientMode).not.toHaveBeenCalled();
  });

  it("404s an unknown mode", async () => {
    updateAmbientMode.mockResolvedValue(null);
    expect((await put("party", { brightness: 50 })).status).toBe(404);
  });
});

describe("POST /api/ambient-modes/:key/apply", () => {
  const apply = (key: string) => ambientModesRouter.request(`/${key}/apply`, { method: "POST" });

  it("applies a known mode and reports the counts", async () => {
    getAmbientMode.mockResolvedValue({ key: "entry" });
    applyAmbientMode.mockResolvedValue({ applied: 3, failed: 0 });
    const res = await apply("entry");
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ key: "entry", applied: 3, failed: 0 });
  });

  it("404s an unknown mode and 502s when no light responded", async () => {
    getAmbientMode.mockResolvedValue(null);
    expect((await apply("party")).status).toBe(404);

    getAmbientMode.mockResolvedValue({ key: "entry" });
    applyAmbientMode.mockResolvedValue({ applied: 0, failed: 3 });
    expect((await apply("entry")).status).toBe(502);
  });
});
