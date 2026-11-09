import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getMediaAsset: vi.fn(),
  createSchedule: vi.fn(async () => ({ id: "s1" })),
  updateSchedule: vi.fn(),
  listSchedules: vi.fn(),
  scheduleExists: vi.fn(),
  setScheduleEnabled: vi.fn(),
  deleteSchedule: vi.fn(),
}));
const media = vi.hoisted(() => ({ libraryVideoSeconds: vi.fn() }));
vi.mock("@platform/db", () => db);
vi.mock("../src/routes/media.js", () => media);
vi.mock("../src/middleware/auth.js", () => {
  const pass = async (_c: unknown, next: () => Promise<void>) => next();
  return { requireAdmin: pass, requireGuestOrAdmin: pass };
});
vi.mock("../src/services/scheduler.js", () => ({ runSchedulerSoon: vi.fn(), scheduleStatus: vi.fn() }));

import { schedulesRouter } from "../src/routes/schedules.js";

const app = new Hono().route("/api/schedules", schedulesRouter);
const base = {
  name: "Lobby",
  color: "#92ff5f",
  enabled: true,
  priority: 0,
  startDate: null,
  endDate: null,
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "09:00",
  endTime: "18:00",
  timezone: "Asia/Kolkata",
  loop: true,
  screenIds: ["tv-1"],
  groupIds: [],
};
const post = (items: unknown[]) =>
  app.request("/api/schedules", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...base, items }),
  });

const assets: Record<string, { id: string; type: string; name: string; url: string }> = {
  vid: { id: "vid", type: "video", name: "Brand film.mp4", url: "/media/brand.mp4" },
  img: { id: "img", type: "image", name: "Poster.png", url: "/media/poster.png" },
};

beforeEach(() => {
  db.getMediaAsset.mockImplementation(async (id: string) => assets[id] ?? null);
  db.createSchedule.mockClear();
  media.libraryVideoSeconds.mockReset();
});

describe("schedule video lengths", () => {
  it("plays a video for its own length, read on the server", async () => {
    media.libraryVideoSeconds.mockResolvedValue(66);
    const res = await post([
      { kind: "media", contentId: "vid", durationSeconds: 0 },
      { kind: "media", contentId: "img", durationSeconds: 15 },
    ]);
    expect(res.status).toBe(201);
    const saved = (db.createSchedule.mock.calls[0] as unknown[])[0] as { items: { durationSeconds: number }[] };
    expect(saved.items.map((i) => i.durationSeconds)).toEqual([66, 15]);
  });

  it("overrides whatever length the browser sent for a video", async () => {
    media.libraryVideoSeconds.mockResolvedValue(30);
    await post([{ kind: "media", contentId: "vid", durationSeconds: 999 }]);
    const saved = (db.createSchedule.mock.calls[0] as unknown[])[0] as { items: { durationSeconds: number }[] };
    expect(saved.items[0]!.durationSeconds).toBe(30);
  });

  it("refuses a video whose length can't be read, naming it", async () => {
    media.libraryVideoSeconds.mockResolvedValue(null);
    const res = await post([{ kind: "media", contentId: "vid", durationSeconds: 0 }]);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("Brand film.mp4");
    expect(db.createSchedule).not.toHaveBeenCalled();
  });

  it("still needs an image to be on screen for at least 5 seconds", async () => {
    const res = await post([{ kind: "media", contentId: "img", durationSeconds: 2 }]);
    expect(res.status).toBe(400);
  });
});
