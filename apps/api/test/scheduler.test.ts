import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleRow, ScheduleScreenStateRow, SchedulerScreenRow } from "@platform/db";

const db = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  listScreensForScheduler: vi.fn(),
  listScheduleScreenStates: vi.fn(),
  upsertScheduleScreenState: vi.fn(),
  deleteScheduleScreenState: vi.fn(),
  setScreenExperience: vi.fn(),
  setScreenMedia: vi.fn(),
}));
const push = vi.hoisted(() => ({ pushScreenContent: vi.fn() }));

vi.mock("@platform/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@platform/db")>();
  return { ...actual, ...db };
});
vi.mock("../src/routes/screens.js", () => push);
vi.mock("../src/ws/gateway.js", () => ({
  clearTakeoverFlag: vi.fn(),
  getConnectedScreenIds: vi.fn(() => []),
}));

import { runSchedulerTick } from "../src/services/scheduler.js";

// Monday 2026-11-09, 10:00:05 in Kolkata (04:30:05 UTC).
const NOW = new Date("2026-11-09T04:30:05.000Z");

const lobby: ScheduleRow = {
  id: "sch-lobby",
  name: "Lobby loop",
  color: "#92ff5f",
  enabled: true,
  priority: 0,
  startDate: null,
  endDate: null,
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  startTime: "09:00",
  endTime: "18:00",
  timezone: "Asia/Kolkata",
  screenIds: [],
  groupIds: ["grp-lobby"],
  items: [
    { id: "i1", kind: "media", contentId: "img-1", durationSeconds: 10, title: "Welcome", mediaType: "image", thumbnailUrl: null },
    { id: "i2", kind: "experience", contentId: "exp-1", durationSeconds: 20, title: "Mosaic", mediaType: null, thumbnailUrl: null },
  ],
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

function screen(over: Partial<SchedulerScreenRow> = {}): SchedulerScreenRow {
  return {
    screenId: "tv-1",
    screenName: "TV 1",
    groupId: "grp-lobby",
    currentContentKind: null,
    currentExperienceId: null,
    currentMediaAssetId: null,
    blanked: false,
    whiteboardActive: false,
    ...over,
  };
}

function state(over: Partial<ScheduleScreenStateRow> = {}): ScheduleScreenStateRow {
  return {
    screenId: "tv-1",
    scheduleId: "sch-lobby",
    // 10:00:05 is 3605s into the window: cycle 120, 5s into item 0.
    itemKey: "sch-lobby:2026-11-09:120:0",
    contentKind: "media",
    contentId: "img-1",
    previousContentKind: "experience",
    previousContentId: "exp-before",
    appliedAt: NOW.toISOString(),
    ...over,
  };
}

function setup(rows: ScheduleRow[], screens: SchedulerScreenRow[], states: ScheduleScreenStateRow[] = []) {
  db.listSchedules.mockResolvedValue(rows);
  db.listScreensForScheduler.mockResolvedValue(screens);
  db.listScheduleScreenStates.mockResolvedValue(states);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const fn of [...Object.values(db), push.pushScreenContent]) fn.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("scheduler tick", () => {
  it("puts the due item on a screen in a targeted group and remembers what was there", async () => {
    setup([lobby], [screen({ currentContentKind: "experience", currentExperienceId: "exp-before" })]);
    await runSchedulerTick();
    expect(db.setScreenMedia).toHaveBeenCalledWith("tv-1", "img-1", { record: false });
    expect(push.pushScreenContent).toHaveBeenCalledWith("tv-1");
    expect(db.upsertScheduleScreenState).toHaveBeenCalledWith(
      expect.objectContaining({
        itemKey: "sch-lobby:2026-11-09:120:0",
        contentId: "img-1",
        previousContentKind: "experience",
        previousContentId: "exp-before",
      })
    );
  });

  it("does nothing while the same item is due", async () => {
    setup([lobby], [screen({ currentContentKind: "media", currentMediaAssetId: "img-1" })], [state()]);
    await runSchedulerTick();
    expect(push.pushScreenContent).not.toHaveBeenCalled();
    expect(db.upsertScheduleScreenState).not.toHaveBeenCalled();
  });

  it("leaves a manual push up until the next item is due", async () => {
    setup([lobby], [screen({ currentContentKind: "media", currentMediaAssetId: "manual" })], [state()]);
    await runSchedulerTick();
    expect(push.pushScreenContent).not.toHaveBeenCalled();
  });

  it("moves on to the next item, keeping the original 'before' content", async () => {
    vi.setSystemTime(new Date(NOW.getTime() + 6_000)); // 11s into the loop → item 1
    setup([lobby], [screen({ currentContentKind: "media", currentMediaAssetId: "manual" })], [state()]);
    await runSchedulerTick();
    expect(db.setScreenExperience).toHaveBeenCalledWith("tv-1", "exp-1", { record: false });
    expect(db.upsertScheduleScreenState).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: "exp-1", previousContentId: "exp-before" })
    );
  });

  it("doesn't re-push content the screen already shows", async () => {
    setup([lobby], [screen({ currentContentKind: "media", currentMediaAssetId: "img-1" })]);
    await runSchedulerTick();
    expect(push.pushScreenContent).not.toHaveBeenCalled();
    expect(db.upsertScheduleScreenState).toHaveBeenCalled(); // but now it's tracked
  });

  it("hands the screen back when the window ends", async () => {
    vi.setSystemTime(new Date("2026-11-09T13:00:00.000Z")); // 18:30 Kolkata
    setup([lobby], [screen({ currentContentKind: "media", currentMediaAssetId: "img-1" })], [state()]);
    await runSchedulerTick();
    expect(db.setScreenExperience).toHaveBeenCalledWith("tv-1", "exp-before", { record: false });
    expect(db.deleteScheduleScreenState).toHaveBeenCalledWith("tv-1");
  });

  it("doesn't undo a manual push when the window ends", async () => {
    vi.setSystemTime(new Date("2026-11-09T13:00:00.000Z"));
    setup([lobby], [screen({ currentContentKind: "media", currentMediaAssetId: "manual" })], [state()]);
    await runSchedulerTick();
    expect(push.pushScreenContent).not.toHaveBeenCalled();
    expect(db.deleteScheduleScreenState).toHaveBeenCalledWith("tv-1");
  });

  it("leaves stopped screens and live whiteboards alone", async () => {
    setup([lobby], [screen({ blanked: true }), screen({ screenId: "tv-2", whiteboardActive: true })]);
    await runSchedulerTick();
    expect(push.pushScreenContent).not.toHaveBeenCalled();
    expect(db.upsertScheduleScreenState).not.toHaveBeenCalled();
  });

  it("ignores screens the schedule doesn't target", async () => {
    setup([lobby], [screen({ groupId: "grp-other" })]);
    await runSchedulerTick();
    expect(push.pushScreenContent).not.toHaveBeenCalled();
  });

  it("re-pushes when the running item's content was edited", async () => {
    const edited = { ...lobby, items: [{ ...lobby.items[0]!, contentId: "img-2" }, lobby.items[1]!] };
    setup([edited], [screen({ currentContentKind: "media", currentMediaAssetId: "img-1" })], [state()]);
    await runSchedulerTick();
    expect(db.setScreenMedia).toHaveBeenCalledWith("tv-1", "img-2", { record: false });
  });

  it("wakes again just after the next change", async () => {
    setup([lobby], [screen()]);
    const delay = await runSchedulerTick();
    expect(delay).toBe(5_000); // next item in 5s, capped at the 5s maximum
  });
});
