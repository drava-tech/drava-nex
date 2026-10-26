import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isGreetingEnabled } from "../src/lib/greeting-flag.js";
import { loadGreetingConfig } from "../src/services/greeting/config.js";
import { GreetingService, DB_ERROR_PAUSE_MS } from "../src/services/greeting/service.js";

describe("GREETING_ENABLED defaults to off", () => {
  it("is off when unset, empty, or anything but an explicit yes", () => {
    for (const v of [undefined, "", "  ", "false", "0", "off", "no", "maybe", "enabled"]) {
      expect(isGreetingEnabled({ GREETING_ENABLED: v })).toBe(false);
    }
    expect(loadGreetingConfig({}).enabled).toBe(false);
  });

  it("turns on only for 1/true/yes/on (any case)", () => {
    for (const v of ["1", "true", "TRUE", "yes", "On"]) {
      expect(isGreetingEnabled({ GREETING_ENABLED: v })).toBe(true);
      expect(loadGreetingConfig({ GREETING_ENABLED: v }).enabled).toBe(true);
    }
  });
});

describe("database errors: log once, pause 5 minutes", () => {
  let clock: number;
  let logged: unknown[][];
  const missingTable = Object.assign(new Error('relation "visitor_greeting" does not exist'), {
    code: "42P01",
  });
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const C = "33333333-3333-4333-8333-333333333333";

  // The real controller calls admit() when the screen is usable; this stands in for it.
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const make = (recordGreeting: () => Promise<boolean>) => {
    const present = vi.fn(async (req: { admit(): Promise<unknown> }) => void (await req.admit()));
    const getVisitor = vi
      .fn()
      .mockResolvedValue({ name: "Priya", firstSeen: new Date("2026-10-01T00:00:00Z") });
    const service = new GreetingService({
      config: loadGreetingConfig({ GREETING_ENABLED: "true", GREET_BATCH_WINDOW_MS: "0" }),
      now: () => new Date(clock),
      getVisitor,
      isInRoom: vi.fn().mockResolvedValue(true),
      recordGreeting,
      recordSkipped: vi.fn().mockResolvedValue(true),
      present,
    });
    return { service, getVisitor, present };
  };

  beforeEach(() => {
    clock = Date.parse("2026-10-24T09:00:00Z");
    logged = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void logged.push(args));
  });
  afterEach(() => vi.restoreAllMocks());

  it("logs a missing visitor_greeting table once and does nothing", async () => {
    const record = vi.fn().mockRejectedValue(missingTable);
    const { service, present } = make(record);

    await service.onVisitorDetected(A);
    await settle();
    await service.onVisitorDetected(B);
    await settle();
    await service.onVisitorDetected(C);
    await settle();

    expect(record).toHaveBeenCalledTimes(1); // later events never touch the DB
    expect(logged).toHaveLength(1);
    expect(String(logged[0]?.[0])).toContain("paused for 5 min");
    expect(String(logged[0]?.[0])).toContain("visitor_greeting");
  });

  it("retries after the pause", async () => {
    const record = vi.fn().mockRejectedValueOnce(missingTable).mockResolvedValue(true);
    const { service } = make(record);

    await service.onVisitorDetected(A);
    await settle();
    clock += DB_ERROR_PAUSE_MS - 1;
    await service.onVisitorDetected(B);
    await settle();
    expect(record).toHaveBeenCalledTimes(1); // still paused

    clock += 2;
    await service.onVisitorDetected(C);
    await settle();
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("rename and merge share the breaker and never throw", async () => {
    const record = vi.fn().mockRejectedValue(missingTable);
    const { service } = make(record);

    await expect(service.onVisitorRenamed(A)).resolves.toBeUndefined();
    await settle();
    await expect(service.onVisitorMerged(B)).resolves.toBeUndefined();
    await settle();
    expect(record).toHaveBeenCalledTimes(1);
    expect(logged).toHaveLength(1);
  });

  it("with the flag off the service does nothing at all", async () => {
    const record = vi.fn();
    const getVisitor = vi.fn();
    const service = new GreetingService({
      config: loadGreetingConfig({}),
      now: () => new Date(clock),
      getVisitor,
      isInRoom: vi.fn(),
      recordGreeting: record,
      recordSkipped: vi.fn(),
      present: vi.fn(),
    });
    await service.onVisitorDetected(A);
    await service.onVisitorRenamed(A);
    await service.onVisitorMerged(A);
    expect(getVisitor).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });
});
