import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GREETING_TZ, loadGreetingConfig } from "../src/services/greeting/config.js";

describe("loadGreetingConfig", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("defaults (nothing set): off, and every documented default", () => {
    expect(loadGreetingConfig({})).toEqual({
      enabled: false,
      timezone: "Asia/Kolkata",
      greetUnknown: "screen",
      voice: "screen",
      presenceWindowSeconds: 120,
      afternoonHour: 12,
      eveningHour: 17,
      batchWindowMs: 3000,
      maxNames: 4,
      welcomeDurationSeconds: 20,
      busySkipsDay: "all",
      welcomeVideoMuted: null,
      nameMode: "full",
      voiceName: null,
      arrivalFreshSeconds: 30,
      retentionDays: 30,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads every variable", () => {
    const c = loadGreetingConfig({
      GREETING_ENABLED: "true",
      GREETING_TZ: "Asia/Tokyo",
      GREET_UNKNOWN: "generic",
      GREETING_VOICE: "off",
      GREET_PRESENCE_WINDOW_SECONDS: "90",
      GREET_AFTERNOON_HOUR: "13",
      GREET_EVENING_HOUR: "18",
      GREET_BATCH_WINDOW_MS: "0",
      GREET_MAX_NAMES: "6",
      WELCOME_SCREEN_DURATION_SECONDS: "45",
      GREET_BUSY_SKIPS_DAY: "whiteboard",
      WELCOME_VIDEO_MUTED: "false",
      GREET_NAME_MODE: "first",
      GREETING_VOICE_NAME: "  Microsoft Heera  ",
      GREET_ARRIVAL_FRESH_SECONDS: "20",
      GREETING_RETENTION_DAYS: "7",
    });
    expect(c).toMatchObject({
      enabled: true,
      timezone: "Asia/Tokyo",
      greetUnknown: "generic",
      voice: "off",
      presenceWindowSeconds: 90,
      afternoonHour: 13,
      eveningHour: 18,
      batchWindowMs: 0,
      maxNames: 6,
      welcomeDurationSeconds: 45,
      busySkipsDay: "whiteboard",
      welcomeVideoMuted: false,
      nameMode: "first",
      voiceName: "Microsoft Heera", // trimmed
      arrivalFreshSeconds: 20,
      retentionDays: 7,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("a bad value warns and falls back to the default — it never throws", () => {
    const c = loadGreetingConfig({
      GREETING_TZ: "Mars/Olympus",
      GREET_UNKNOWN: "maybe",
      GREETING_VOICE: "robot",
      GREET_PRESENCE_WINDOW_SECONDS: "abc",
      GREET_BATCH_WINDOW_MS: "-5",
      GREET_MAX_NAMES: "0",
      WELCOME_SCREEN_DURATION_SECONDS: "99999",
      GREET_BUSY_SKIPS_DAY: "some",
      GREET_NAME_MODE: "nickname",
      GREET_ARRIVAL_FRESH_SECONDS: "1.5",
      GREETING_RETENTION_DAYS: "0",
    });
    expect(c).toMatchObject({
      timezone: DEFAULT_GREETING_TZ,
      greetUnknown: "screen",
      voice: "screen",
      presenceWindowSeconds: 120,
      batchWindowMs: 3000,
      maxNames: 4,
      welcomeDurationSeconds: 20,
      busySkipsDay: "all",
      nameMode: "full",
      arrivalFreshSeconds: 30,
      retentionDays: 30,
    });
    expect(warn).toHaveBeenCalledTimes(11);
  });

  it("only 1/true/yes/on enable it — a typo means off", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) expect(loadGreetingConfig({ GREETING_ENABLED: v }).enabled).toBe(true);
    for (const v of ["", "0", "false", "ture", "enabled", "2"]) expect(loadGreetingConfig({ GREETING_ENABLED: v }).enabled).toBe(false);
  });

  it("evening must be after afternoon, else both revert to 12/17", () => {
    const c = loadGreetingConfig({ GREET_AFTERNOON_HOUR: "15", GREET_EVENING_HOUR: "15" });
    expect([c.afternoonHour, c.eveningHour]).toEqual([12, 17]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("GREET_EVENING_HOUR must be after"));
  });

  it("enums are case-insensitive", () => {
    expect(loadGreetingConfig({ GREET_UNKNOWN: "GENERIC", GREET_NAME_MODE: "First" })).toMatchObject({
      greetUnknown: "generic",
      nameMode: "first",
    });
  });

  it("a very long voice name is clipped, an empty one means none", () => {
    expect(loadGreetingConfig({ GREETING_VOICE_NAME: "x".repeat(300) }).voiceName).toHaveLength(100);
    expect(loadGreetingConfig({ GREETING_VOICE_NAME: "   " }).voiceName).toBeNull();
  });

  describe("WELCOME_VIDEO_MUTED, as resolved by the config", () => {
    it("unset: muted while greetings are on, untouched while off", () => {
      expect(loadGreetingConfig({ GREETING_ENABLED: "true" }).welcomeVideoMuted).toBe(true);
      expect(loadGreetingConfig({}).welcomeVideoMuted).toBeNull();
    });
    it("true/false override either way", () => {
      expect(loadGreetingConfig({ WELCOME_VIDEO_MUTED: "true" }).welcomeVideoMuted).toBe(true);
      expect(loadGreetingConfig({ GREETING_ENABLED: "true", WELCOME_VIDEO_MUTED: "false" }).welcomeVideoMuted).toBe(false);
    });
  });
});
