import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MotionTriggerRow, ScheduleRow, SchedulerScreenRow } from "@platform/db";

const db = vi.hoisted(() => ({
  listMotionTriggers: vi.fn(),
  listSchedules: vi.fn(async () => []),
  listScreensForScheduler: vi.fn(),
  listScheduleScreenStates: vi.fn(async () => []),
  upsertScheduleScreenState: vi.fn(),
  deleteScheduleScreenState: vi.fn(),
  setScreenExperience: vi.fn(),
  setScreenMedia: vi.fn(),
}));
const push = vi.hoisted(() => ({ pushScreenContent: vi.fn() }));
vi.mock("@platform/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@platform/db")>()), ...db }));
vi.mock("../src/routes/screens.js", () => push);
vi.mock("../src/ws/gateway.js", () => ({ clearTakeoverFlag: vi.fn(), getConnectedScreenIds: vi.fn(() => []) }));

import { fireMotionSensor, resetMotionState, startTrigger, withinTriggerHours } from "../src/services/motion-triggers.js";
import { runSchedulerTick } from "../src/services/scheduler.js";

// Monday 2026-11-09, 10:00 in Kolkata.
const NOW = new Date("2026-11-09T04:30:00.000Z");

const lobbyMotion: MotionTriggerRow = {
  id: "mt-1",
  name: "Lobby hello",
  sensorId: "binary_sensor.lobby_motion",
  screenIds: ["tv-1"],
  groupIds: [],
  media: { id: "hello-video", name: "Hello.mp4", type: "video", url: "/media/hello.mp4", thumbnailUrl: null },
  durationSeconds: 20,
  cooldownSeconds: 300,
  startTime: "09:00",
  endTime: "18:00",
  daysOfWeek: [1, 2, 3, 4, 5],
  timezone: "Asia/Kolkata",
  createdAt: "2026-11-01T00:00:00.000Z",
};

const screen = (over: Partial<SchedulerScreenRow> = {}): SchedulerScreenRow => ({
  screenId: "tv-1",
  screenName: "TV 1",
  groupId: null,
  currentContentKind: "media",
  currentMediaAssetId: "before",
  currentExperienceId: null,
  blanked: false,
  whiteboardActive: false,
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  resetMotionState();
  for (const fn of [...Object.values(db), push.pushScreenContent]) fn.mockClear();
  db.listMotionTriggers.mockResolvedValue([lobbyMotion]);
  // mockClear keeps return values: start every test with no schedules and no screen state.
  db.listSchedules.mockResolvedValue([]);
  db.listScheduleScreenStates.mockResolvedValue([]);
  db.listScreensForScheduler.mockResolvedValue([screen()]);
});
afterEach(() => vi.useRealTimers());

describe("firing a motion trigger", () => {
  it("fires the triggers set up for that sensor (any letter case)", async () => {
    const [outcome] = await fireMotionSensor("BINARY_SENSOR.Lobby_Motion", NOW.getTime());
    expect(outcome).toMatchObject({ triggerId: "mt-1", fired: true });
    expect(await fireMotionSensor("binary_sensor.kitchen", NOW.getTime())).toEqual([]);
  });

  it("doesn't restart while playing, and waits out the cooldown afterwards", async () => {
    const t = NOW.getTime();
    expect(startTrigger(lobbyMotion, t).fired).toBe(true);
    expect(startTrigger(lobbyMotion, t + 5_000)).toMatchObject({ fired: false, reason: "already playing" });
    // Played 20s; cooldown 5 min from then.
    expect(startTrigger(lobbyMotion, t + 60_000)).toMatchObject({ fired: false, reason: "cooling down" });
    expect(startTrigger(lobbyMotion, t + 20_000 + 300_000).fired).toBe(true);
  });

  it("only fires within its hours, unless tested", () => {
    const evening = new Date("2026-11-09T14:00:00.000Z").getTime(); // 19:30 Kolkata
    expect(withinTriggerHours(lobbyMotion, evening)).toBe(false);
    expect(startTrigger(lobbyMotion, evening)).toMatchObject({ fired: false, reason: "outside its hours" });
    expect(startTrigger(lobbyMotion, evening, true).fired).toBe(true); // the Test button
  });

  it("needs content to play", () => {
    expect(startTrigger({ ...lobbyMotion, media: null }, NOW.getTime())).toMatchObject({ fired: false, reason: "no content" });
  });
});

describe("the scheduler and a motion trigger", () => {
  const schedule: ScheduleRow = {
    id: "sch-1",
    name: "Lobby loop",
    color: "#92ff5f",
    enabled: true,
    priority: 0,
    startDate: null,
    endDate: null,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: null,
    endTime: null,
    timezone: "Asia/Kolkata",
    loop: true,
    afterMedia: null,
    screenIds: ["tv-1"],
    groupIds: [],
    items: [{ id: "i1", kind: "media", contentId: "loop-img", durationSeconds: 3600, title: "Loop", mediaType: "image", thumbnailUrl: null, mediaUrl: null }],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  };

  it("plays the trigger's content over a running schedule, then the schedule resumes", async () => {
    db.listSchedules.mockResolvedValue([schedule] as never);
    db.listScreensForScheduler.mockResolvedValue([screen({ currentMediaAssetId: "loop-img" })]);
    startTrigger(lobbyMotion, NOW.getTime());
    await runSchedulerTick();
    expect(db.setScreenMedia).toHaveBeenLastCalledWith("tv-1", "hello-video", { record: false });
    const motionState = (db.upsertScheduleScreenState.mock.calls.at(-1) as unknown[])[0] as { scheduleId: string; itemKey: string };
    expect(motionState.scheduleId).toBe("motion:mt-1");

    // 25s later the 20s trigger is over: the schedule's item comes back.
    vi.setSystemTime(new Date(NOW.getTime() + 25_000));
    db.listScreensForScheduler.mockResolvedValue([screen({ currentMediaAssetId: "hello-video" })]);
    db.listScheduleScreenStates.mockResolvedValue([
      { screenId: "tv-1", scheduleId: "motion:mt-1", itemKey: motionState.itemKey, contentKind: "media", contentId: "hello-video", previousContentKind: "media", previousContentId: "loop-img", appliedAt: NOW.toISOString() },
    ] as never);
    await runSchedulerTick();
    expect(db.setScreenMedia).toHaveBeenLastCalledWith("tv-1", "loop-img", { record: false });
  });

  it("gives the screen back what it showed before when no schedule is on", async () => {
    db.listSchedules.mockResolvedValue([]);
    startTrigger(lobbyMotion, NOW.getTime());
    await runSchedulerTick();
    expect(db.upsertScheduleScreenState).toHaveBeenLastCalledWith(
      expect.objectContaining({ contentId: "hello-video", previousContentId: "before" })
    );
    vi.setSystemTime(new Date(NOW.getTime() + 25_000));
    db.listScreensForScheduler.mockResolvedValue([screen({ currentMediaAssetId: "hello-video" })]);
    db.listScheduleScreenStates.mockResolvedValue([
      { screenId: "tv-1", scheduleId: "motion:mt-1", itemKey: "k", contentKind: "media", contentId: "hello-video", previousContentKind: "media", previousContentId: "before", appliedAt: NOW.toISOString() },
    ] as never);
    await runSchedulerTick();
    expect(db.setScreenMedia).toHaveBeenLastCalledWith("tv-1", "before", { record: false });
  });

  it("leaves screens it doesn't target alone", async () => {
    db.listScreensForScheduler.mockResolvedValue([screen({ screenId: "tv-2" })]);
    startTrigger(lobbyMotion, NOW.getTime());
    await runSchedulerTick();
    expect(push.pushScreenContent).not.toHaveBeenCalled();
  });
});
