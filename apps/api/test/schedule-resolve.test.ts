import { describe, expect, it } from "vitest";
import {
  activeWindow,
  describeDays,
  describeWindow,
  localParts,
  nextWindowStart,
  onAirMinutes,
  playlistPosition,
  queueTimeline,
  resolveSchedules,
  schedulesOverlap,
  weekSegments,
  zonedTimeToInstant,
  type ScheduleSpec,
} from "@platform/types";

const TZ = "Asia/Kolkata"; // UTC+05:30, no DST

/** An instant given as Kolkata wall-clock time. */
const at = (date: string, time: string) => {
  const [h, m, s = "0"] = time.split(":");
  return zonedTimeToInstant(date, Number(h) * 60 + Number(m), TZ).getTime() + Number(s) * 1000;
};

function spec(over: Partial<ScheduleSpec> = {}): ScheduleSpec {
  return {
    id: "s1",
    name: "Lobby loop",
    enabled: true,
    priority: 0,
    startDate: null,
    endDate: null,
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: "09:00",
    endTime: "18:00",
    timezone: TZ,
    loop: true,
    afterMediaId: null,
    items: [
      { id: "a", kind: "media", contentId: "m1", durationSeconds: 10 },
      { id: "b", kind: "experience", contentId: "e1", durationSeconds: 20 },
    ],
    createdAt: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

// 2026-11-09 is a Monday.
describe("time helpers", () => {
  it("converts Kolkata wall time to an instant and back", () => {
    const instant = zonedTimeToInstant("2026-11-09", 9 * 60, TZ);
    expect(instant.toISOString()).toBe("2026-11-09T03:30:00.000Z");
    expect(localParts(instant, TZ)).toMatchObject({ date: "2026-11-09", weekday: 1, minutes: 540 });
  });

  it("handles a DST zone", () => {
    // New York, the day DST ends (2026-11-01): 09:00 local is UTC-5.
    const instant = zonedTimeToInstant("2026-11-01", 9 * 60, "America/New_York");
    expect(instant.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });
});

describe("activeWindow", () => {
  it("is on inside the daily window and off outside it", () => {
    expect(activeWindow(spec(), new Date(at("2026-11-09", "08:59")))).toBeNull();
    expect(activeWindow(spec(), new Date(at("2026-11-09", "09:00")))).toMatchObject({ date: "2026-11-09", elapsedSeconds: 0 });
    expect(activeWindow(spec(), new Date(at("2026-11-09", "17:59")))?.remainingSeconds).toBe(60);
    expect(activeWindow(spec(), new Date(at("2026-11-09", "18:00")))).toBeNull();
  });

  it("treats no times as all day", () => {
    const s = spec({ startTime: null, endTime: null });
    expect(activeWindow(s, new Date(at("2026-11-09", "00:00")))?.elapsedSeconds).toBe(0);
    expect(activeWindow(s, new Date(at("2026-11-09", "23:59")))).not.toBeNull();
  });

  it("runs an overnight window into the next morning, as the day it started", () => {
    // Fridays only, 22:00–06:00.
    const s = spec({ startTime: "22:00", endTime: "06:00", daysOfWeek: [5] });
    expect(activeWindow(s, new Date(at("2026-11-13", "23:00")))?.date).toBe("2026-11-13"); // Fri night
    expect(activeWindow(s, new Date(at("2026-11-14", "05:00")))?.date).toBe("2026-11-13"); // Sat morning
    expect(activeWindow(s, new Date(at("2026-11-14", "23:00")))).toBeNull(); // Sat night: not a Friday
    expect(activeWindow(s, new Date(at("2026-11-13", "05:00")))).toBeNull(); // Fri morning: Thursday's window
  });

  it("honours weekdays and the date range", () => {
    const weekdays = spec({ daysOfWeek: [1, 2, 3, 4, 5] });
    expect(activeWindow(weekdays, new Date(at("2026-11-14", "10:00")))).toBeNull(); // Saturday
    const ranged = spec({ startDate: "2026-11-10", endDate: "2026-11-12" });
    expect(activeWindow(ranged, new Date(at("2026-11-09", "10:00")))).toBeNull();
    expect(activeWindow(ranged, new Date(at("2026-11-12", "10:00")))).not.toBeNull();
    expect(activeWindow(ranged, new Date(at("2026-11-13", "10:00")))).toBeNull();
  });
});

describe("playlist", () => {
  it("steps through the items and loops", () => {
    const s = spec();
    expect(playlistPosition(s.items, 0)).toMatchObject({ index: 0, cycle: 0, itemRemainingSeconds: 10 });
    expect(playlistPosition(s.items, 10)).toMatchObject({ index: 1, cycle: 0, itemRemainingSeconds: 20 });
    expect(playlistPosition(s.items, 29)).toMatchObject({ index: 1, itemRemainingSeconds: 1 });
    expect(playlistPosition(s.items, 30)).toMatchObject({ index: 0, cycle: 1 });
  });

  it("puts every screen on the same item at the same moment", () => {
    const now = new Date(at("2026-11-09", "09:00:45"));
    const r = resolveSchedules([spec()], now);
    expect(r?.position.index).toBe(1); // 45s into a 30s loop: 15s → item b
    expect(r?.key).toBe("s1:2026-11-09:1:1");
    expect(r?.changesInSeconds).toBe(15);
  });
});

describe("long items and play once", () => {
  // 09:00–18:00: a 3-hour item, then a 1-hour item.
  const long = () =>
    spec({
      items: [
        { id: "a", kind: "media", contentId: "m1", durationSeconds: 3 * 3600 },
        { id: "b", kind: "media", contentId: "m2", durationSeconds: 3600 },
      ],
    });

  it("shows the 3-hour item until 12:00, then the 1-hour one until 13:00", () => {
    expect(resolveSchedules([long()], new Date(at("2026-11-09", "11:59")))?.position.index).toBe(0);
    expect(resolveSchedules([long()], new Date(at("2026-11-09", "12:00")))?.position.index).toBe(1);
    expect(resolveSchedules([long()], new Date(at("2026-11-09", "13:00")))?.position.index).toBe(0); // repeats
  });

  it("goes off air after one pass when it plays once", () => {
    const once = { ...long(), loop: false };
    expect(resolveSchedules([once], new Date(at("2026-11-09", "12:30")))?.position.index).toBe(1);
    expect(resolveSchedules([once], new Date(at("2026-11-09", "13:00")))).toBeNull();
    expect(onAirMinutes(once)).toBe(4 * 60);
    expect(weekSegments(once, "2026-11-09", 1)).toEqual([{ date: "2026-11-09", startMinute: 540, endMinute: 780 }]);
  });

  it("lays the queue out on the clock and flags what does not fit", () => {
    const tl = queueTimeline({ startTime: "16:00", endTime: "18:00" }, long().items);
    expect(tl[0]).toMatchObject({ startSecond: 16 * 3600, endSecond: 19 * 3600, fits: true, cutShort: true });
    expect(tl[1]).toMatchObject({ fits: false });
  });
});

describe("resolveSchedules", () => {
  it("lets the higher priority win and reports the loser", () => {
    const low = spec({ id: "low", priority: 0 });
    const high = spec({ id: "high", priority: 5, startTime: "12:00", endTime: "13:00" });
    const lunch = resolveSchedules([low, high], new Date(at("2026-11-09", "12:30")));
    expect(lunch?.schedule.id).toBe("high");
    expect(lunch?.overridden.map((s) => s.id)).toEqual(["low"]);
    expect(resolveSchedules([low, high], new Date(at("2026-11-09", "14:00")))?.schedule.id).toBe("low");
  });

  it("breaks a priority tie in favour of the newer schedule", () => {
    const older = spec({ id: "older", createdAt: "2026-11-01T00:00:00.000Z" });
    const newer = spec({ id: "newer", createdAt: "2026-11-05T00:00:00.000Z" });
    expect(resolveSchedules([older, newer], new Date(at("2026-11-09", "10:00")))?.schedule.id).toBe("newer");
  });

  it("skips disabled and empty schedules", () => {
    const now = new Date(at("2026-11-09", "10:00"));
    expect(resolveSchedules([spec({ enabled: false })], now)).toBeNull();
    expect(resolveSchedules([spec({ items: [] })], now)).toBeNull();
  });

  it("ends an item early when the window closes first", () => {
    const r = resolveSchedules([spec({ endTime: "09:01" })], new Date(at("2026-11-09", "09:00:55")));
    expect(r?.changesInSeconds).toBe(5);
  });
});

describe("week view and planning", () => {
  it("splits an overnight window across the two days", () => {
    const s = spec({ startTime: "22:00", endTime: "02:00", daysOfWeek: [1] });
    expect(weekSegments(s, "2026-11-09", 2)).toEqual([
      { date: "2026-11-09", startMinute: 22 * 60, endMinute: 24 * 60 },
      { date: "2026-11-10", startMinute: 0, endMinute: 2 * 60 },
    ]);
  });

  it("finds the next window start", () => {
    const s = spec({ daysOfWeek: [3] }); // Wednesdays 09:00
    expect(nextWindowStart(s, new Date(at("2026-11-09", "12:00")))?.toISOString()).toBe(
      new Date(at("2026-11-11", "09:00")).toISOString()
    );
  });

  it("detects overlapping schedules", () => {
    const morning = spec({ id: "m", startTime: "09:00", endTime: "12:00" });
    const lunch = spec({ id: "l", startTime: "11:30", endTime: "13:00" });
    const evening = spec({ id: "e", startTime: "18:00", endTime: "20:00" });
    expect(schedulesOverlap(morning, lunch, "2026-11-09")).toBe(true);
    expect(schedulesOverlap(morning, evening, "2026-11-09")).toBe(false);
  });

  it("describes days and windows in words", () => {
    expect(describeDays([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(describeDays([0, 6])).toBe("Weekends");
    expect(describeDays([1, 3])).toBe("Mon, Wed");
    expect(describeWindow({ startTime: null, endTime: null })).toBe("All day");
    expect(describeWindow({ startTime: "22:00", endTime: "06:00" })).toBe("22:00–06:00 (next day)");
  });
});
