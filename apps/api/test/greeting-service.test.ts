import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadGreetingConfig } from "../src/services/greeting/config.js";
import type { BusyReason, GreetingPresentation, GreetingRequest } from "../src/services/greeting/screen.js";
import { GreetingService, type GreetingServiceDeps } from "../src/services/greeting/service.js";

const PRIYA = "11111111-1111-4111-8111-111111111111";
const ARJUN = "22222222-2222-4222-8222-222222222222";
const UNKNOWN = "33333333-3333-4333-8333-333333333333";

type Kind = "generic" | "named" | "skipped";
interface Row {
  kind: Kind;
  source: string;
  reason?: string;
}

/** visitor_greeting with the same rules as the SQL in @platform/db: it outlives any service instance. */
function makeStore() {
  const rows = new Map<string, Row>();
  const key = (u: string, d: string) => `${u}|${d}`;
  return {
    rows,
    get: (u: string, d: string) => rows.get(key(u, d)),
    recordGreeting: vi.fn(async (i: { visitorUuid: string; greetDate: string; kind: "generic" | "named"; source: string }) => {
      const k = key(i.visitorUuid, i.greetDate);
      const cur = rows.get(k);
      if (!cur) {
        rows.set(k, { kind: i.kind, source: i.source });
        return true;
      }
      if (i.kind === "named" && cur.kind === "generic") {
        rows.set(k, { kind: "named", source: i.source }); // upgrade in place
        return true;
      }
      return false; // already greeted, or skipped: a skipped row is never upgraded
    }),
    recordSkipped: vi.fn(async (i: { visitorUuid: string; greetDate: string; source: string; reason: string }) => {
      const k = key(i.visitorUuid, i.greetDate);
      if (rows.has(k)) return false; // never overwrites an earlier row
      rows.set(k, { kind: "skipped", source: i.source, reason: i.reason });
      return true;
    }),
  };
}

type Screen = { kind: "idle" } | { kind: "welcome" } | { kind: "offline" } | { kind: "busy"; reason: BusyReason };

describe("GreetingService — busy screen, skipped rows, and the daily gate", () => {
  let clock: number;
  let info: ReturnType<typeof vi.spyOn>;
  let screen: Screen;
  let presented: GreetingPresentation[];
  let store: ReturnType<typeof makeStore>;
  const visitors: Record<string, { name: string; firstSeen: Date }> = {};
  /** seconds since the vision service last saw each visitor (the DB's last_seen) */
  let lastSeenAgo: Record<string, number>;

  // 2026-10-24 14:30 IST
  const NOON_ISH = Date.parse("2026-10-24T09:00:00Z");
  const DAY = "2026-10-24";
  const NEXT_DAY_MS = 24 * 3600_000;

  const build = (env: Record<string, string> = {}, sharedStore = store): GreetingService => {
    const deps: GreetingServiceDeps = {
      config: loadGreetingConfig({ GREETING_ENABLED: "true", GREET_BATCH_WINDOW_MS: "0", ...env }),
      now: () => new Date(clock),
      getVisitor: async (u) => visitors[u] ?? null,
      isInRoom: async (u, windowSeconds = 120) => (lastSeenAgo[u] ?? 0) <= windowSeconds,
      recordGreeting: sharedStore.recordGreeting,
      recordSkipped: sharedStore.recordSkipped,
      // stands in for ScreenController.present: classify, then call exactly one outcome
      present: async (req: GreetingRequest) => {
        if (screen.kind === "offline") return req.onOffline();
        if (screen.kind === "busy") return req.onBusy(screen.reason);
        const p = await req.admit();
        if (p) presented.push(p);
      },
    };
    return new GreetingService(deps);
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const arrive = async (s: GreetingService, uuid: string) => {
    await s.onVisitorDetected(uuid);
    await settle();
  };
  const logs = () => info.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    clock = NOON_ISH;
    screen = { kind: "idle" };
    presented = [];
    lastSeenAgo = {};
    store = makeStore();
    visitors[PRIYA] = { name: "Priya", firstSeen: new Date("2026-10-01T00:00:00Z") };
    visitors[ARJUN] = { name: "Arjun", firstSeen: new Date("2026-10-24T03:00:00Z") };
    visitors[UNKNOWN] = { name: "", firstSeen: new Date(NOON_ISH) };
    info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  describe("busy screen (GREET_BUSY_SKIPS_DAY=all, the default)", () => {
    it.each<BusyReason>(["whiteboard", "blanked", "content"])(
      "%s: records a 'skipped' row with the reason, shows and says nothing, and logs it",
      async (reason) => {
        screen = { kind: "busy", reason };
        const s = build();
        await arrive(s, PRIYA);

        expect(store.get(PRIYA, DAY)).toEqual({ kind: "skipped", source: "arrival", reason });
        expect(presented).toEqual([]);
        expect(logs()).toContain(`[greeting] screen busy (${reason}) — skipped, no greeting today — Priya`);
      }
    );

    it("is not counted as a greeting in the logs", async () => {
      screen = { kind: "busy", reason: "content" };
      await arrive(build(), PRIYA);
      expect(logs().some((l) => l.includes("Welcome"))).toBe(false); // no greeting line was ever logged
      expect(logs().some((l) => l.includes("counted as greeted"))).toBe(false);
    });

    it("blocks the rest of the day: later arrival, rename and merge all do nothing", async () => {
      screen = { kind: "busy", reason: "blanked" };
      const s = build();
      await arrive(s, PRIYA);
      expect(store.get(PRIYA, DAY)?.kind).toBe("skipped");

      screen = { kind: "idle" }; // the screen frees up
      s.invalidate(PRIYA);
      await arrive(s, PRIYA);
      await s.onVisitorRenamed(PRIYA);
      await settle();
      await s.onVisitorMerged(PRIYA);
      await settle();

      expect(presented).toEqual([]);
      expect(store.get(PRIYA, DAY)?.kind).toBe("skipped"); // never upgraded to 'named'
    });

    it("survives an API restart (a new service instance, same table)", async () => {
      screen = { kind: "busy", reason: "content" };
      await arrive(build(), PRIYA);

      screen = { kind: "idle" };
      const afterRestart = build(); // empty cache, as after a restart
      await arrive(afterRestart, PRIYA);
      await afterRestart.onVisitorRenamed(PRIYA);
      await settle();

      expect(presented).toEqual([]);
      expect(store.get(PRIYA, DAY)?.kind).toBe("skipped");
    });

    it("the next day is normal again", async () => {
      screen = { kind: "busy", reason: "content" };
      const s = build();
      await arrive(s, PRIYA);

      screen = { kind: "idle" };
      clock += NEXT_DAY_MS;
      await arrive(s, PRIYA);

      expect(presented).toHaveLength(1);
      expect(presented[0]!.voiceText).toContain("Priya");
      expect(store.get(PRIYA, "2026-10-25")?.kind).toBe("named");
      expect(store.get(PRIYA, DAY)?.kind).toBe("skipped"); // yesterday's record is untouched
    });

    it("a visitor already greeted earlier today stays 'named'/'generic' — never overwritten by 'skipped'", async () => {
      const s = build();
      await arrive(s, PRIYA); // greeted while the screen was free
      await arrive(s, UNKNOWN);
      expect(store.get(PRIYA, DAY)?.kind).toBe("named");
      expect(store.get(UNKNOWN, DAY)?.kind).toBe("generic");

      screen = { kind: "busy", reason: "content" };
      s.invalidate(PRIYA);
      s.invalidate(UNKNOWN);
      await arrive(s, PRIYA);
      await arrive(s, UNKNOWN);
      await s.onVisitorRenamed(PRIYA);
      await settle();

      expect(store.get(PRIYA, DAY)?.kind).toBe("named");
      expect(store.get(UNKNOWN, DAY)?.kind).toBe("generic");
      expect(logs().some((l) => l.includes("skipped, no greeting today"))).toBe(false);
    });

    it("only the visitors who were really skipped are logged, in a mixed batch", async () => {
      vi.useFakeTimers();
      try {
        store.rows.set(`${PRIYA}|${DAY}`, { kind: "named", source: "arrival" }); // greeted earlier today
        screen = { kind: "busy", reason: "content" };
        const s = build({ GREET_BATCH_WINDOW_MS: "3000" });

        await s.onVisitorDetected(PRIYA); // both land in the same batch window
        await s.onVisitorDetected(ARJUN);
        await vi.advanceTimersByTimeAsync(3000);

        expect(store.get(ARJUN, DAY)?.kind).toBe("skipped");
        expect(store.get(PRIYA, DAY)?.kind).toBe("named"); // not overwritten
        expect(logs()).toContain("[greeting] screen busy (content) — skipped, no greeting today — Arjun");
      } finally {
        vi.useRealTimers();
      }
    });

    it("an unknown visitor is skipped too, and the log says who", async () => {
      screen = { kind: "busy", reason: "whiteboard" };
      await arrive(build(), UNKNOWN);
      expect(store.get(UNKNOWN, DAY)).toEqual({ kind: "skipped", source: "arrival", reason: "whiteboard" });
      expect(logs()).toContain(`[greeting] screen busy (whiteboard) — skipped, no greeting today — unknown ${UNKNOWN.slice(0, 8)}`);
    });

    it("a rename or merge that finds the screen busy is skipped as well, with its own source", async () => {
      screen = { kind: "busy", reason: "content" };
      const s = build();
      await s.onVisitorRenamed(PRIYA);
      await settle();
      expect(store.get(PRIYA, DAY)).toEqual({ kind: "skipped", source: "rename", reason: "content" });

      await s.onVisitorMerged(ARJUN);
      await settle();
      expect(store.get(ARJUN, DAY)).toEqual({ kind: "skipped", source: "merge", reason: "content" });
    });

    it("GREET_UNKNOWN=off never consults the screen: recorded as greeted even when busy", async () => {
      screen = { kind: "busy", reason: "content" };
      await arrive(build({ GREET_UNKNOWN: "off" }), UNKNOWN);
      expect(store.get(UNKNOWN, DAY)?.kind).toBe("generic");
    });
  });

  describe("GREET_BUSY_SKIPS_DAY=whiteboard", () => {
    it("a live whiteboard still writes 'skipped'", async () => {
      screen = { kind: "busy", reason: "whiteboard" };
      await arrive(build({ GREET_BUSY_SKIPS_DAY: "whiteboard" }), PRIYA);
      expect(store.get(PRIYA, DAY)).toMatchObject({ kind: "skipped", reason: "whiteboard" });
    });

    it.each<BusyReason>(["blanked", "content"])(
      "%s: the visitor counts as greeted, silently (the old behaviour)",
      async (reason) => {
        screen = { kind: "busy", reason };
        await arrive(build({ GREET_BUSY_SKIPS_DAY: "whiteboard" }), PRIYA);

        expect(store.get(PRIYA, DAY)?.kind).toBe("named");
        expect(presented).toEqual([]);
        expect(logs()).toContain(`[greeting] screen busy (${reason}) — skipped (counted as greeted) — Priya`);
      }
    );
  });

  describe("screen usable: the gate behaves as before", () => {
    it("greets once per day, then the repeats are quiet", async () => {
      const s = build();
      await arrive(s, PRIYA);
      await arrive(s, PRIYA);
      expect(presented).toHaveLength(1);
      expect(presented[0]!.voiceText).toBe("Good afternoon, Priya. Welcome back.");
      expect(store.recordGreeting).toHaveBeenCalledTimes(1);
    });

    it("greeted as unknown in the morning, renamed while out, named arrival later: greeted by name once", async () => {
      const s = build();
      await arrive(s, UNKNOWN);
      expect(store.get(UNKNOWN, DAY)?.kind).toBe("generic");

      visitors[UNKNOWN] = { name: "Meera", firstSeen: new Date(NOON_ISH) }; // renamed while out of the room
      s.invalidate(UNKNOWN);
      await arrive(s, UNKNOWN);
      expect(presented.at(-1)?.voiceText).toBe("Good afternoon, Meera. Welcome.");
      expect(store.get(UNKNOWN, DAY)).toEqual({ kind: "named", source: "arrival" });

      await arrive(s, UNKNOWN);
      await s.onVisitorRenamed(UNKNOWN);
      await settle();
      expect(presented.filter((p) => p.voiceText?.includes("Meera"))).toHaveLength(1);
    });

    it("rename of a generic greeting upgrades it and says 'Nice to meet you'", async () => {
      const s = build();
      await arrive(s, UNKNOWN);
      visitors[UNKNOWN] = { name: "Meera", firstSeen: new Date(NOON_ISH) };
      await s.onVisitorRenamed(UNKNOWN);
      await settle();
      expect(presented.at(-1)?.voiceText).toBe("Good afternoon, Meera. Nice to meet you.");
      expect(store.get(UNKNOWN, DAY)?.kind).toBe("named");
    });

    it("nobody left to greet (all already greeted): the controller is not asked to show anything", async () => {
      const s = build();
      await arrive(s, PRIYA);
      presented.length = 0;
      s.invalidate(PRIYA);
      await arrive(s, PRIYA); // DB says already greeted
      expect(presented).toEqual([]);
    });
  });

  // ─────────────────────────── must-fix: freshness, offline, names, logging ───────────────────────────

  describe("arrival freshness (a replayed or old sighting must not greet someone who has left)", () => {
    const ago = (seconds: number) => new Date(clock - seconds * 1000).toISOString();

    it("ignores an event whose own timestamp is older than the window — without touching the DB", async () => {
      const s = build();
      await s.onVisitorDetected(PRIYA, { eventLastSeen: ago(120) });
      await settle();

      expect(store.recordGreeting).not.toHaveBeenCalled();
      expect(presented).toEqual([]);
      expect(logs()).toContain(`[greeting] ignored stale sighting (event is 120s old) — ${PRIYA.slice(0, 8)}`);
    });

    it("ignores a sighting the database says is old (last_seen on the DB clock)", async () => {
      lastSeenAgo[PRIYA] = 300; // seen 5 minutes ago
      await arrive(build(), PRIYA);

      expect(store.recordGreeting).not.toHaveBeenCalled();
      expect(presented).toEqual([]);
      expect(logs().some((l) => l.includes("ignored stale sighting (not seen in the last 60s)"))).toBe(true);
    });

    it("allows for the vision service's own 30 s write cooldown (a real sighting can lag that much)", async () => {
      lastSeenAgo[PRIYA] = 55;
      await arrive(build(), PRIYA);
      expect(presented).toHaveLength(1);
    });

    it("a fresh event is fine, and the window is configurable", async () => {
      await build().onVisitorDetected(PRIYA, { eventLastSeen: ago(10) });
      await settle();
      expect(presented).toHaveLength(1);

      presented.length = 0;
      store.rows.clear();
      await build({ GREET_ARRIVAL_FRESH_SECONDS: "5" }).onVisitorDetected(PRIYA, { eventLastSeen: ago(10) });
      await settle();
      expect(presented).toEqual([]); // 10 s old is now stale
    });

    it("an unparseable timestamp doesn't block (the DB check is the authority)", async () => {
      await build().onVisitorDetected(PRIYA, { eventLastSeen: "not a date" });
      await settle();
      expect(presented).toHaveLength(1);
    });

    it("logs the skip once, not on every repeated stale event", async () => {
      const s = build();
      for (let i = 0; i < 4; i++) await s.onVisitorDetected(PRIYA, { eventLastSeen: ago(120) });
      await settle();
      expect(logs().filter((l) => l.includes("ignored stale sighting"))).toHaveLength(1);

      clock += 5 * 60_000 + 1; // the repeat-log window passes
      await s.onVisitorDetected(PRIYA, { eventLastSeen: new Date(clock - 120_000).toISOString() });
      expect(logs().filter((l) => l.includes("ignored stale sighting"))).toHaveLength(2);
    });

    it("a stale event records nothing and doesn't use up the day: a later fresh sighting still greets", async () => {
      const s = build();
      await s.onVisitorDetected(PRIYA, { eventLastSeen: ago(120) });
      await settle();
      expect(store.rows.size).toBe(0);

      await s.onVisitorDetected(PRIYA, { eventLastSeen: ago(1) });
      await settle();
      expect(presented).toHaveLength(1);
    });

    it("counts them for the status endpoint", async () => {
      const s = build();
      await s.onVisitorDetected(PRIYA, { eventLastSeen: ago(120) });
      expect(s.status().counters.staleIgnored).toBe(1);
    });
  });

  describe("screen offline (no connected player)", () => {
    beforeEach(() => {
      screen = { kind: "offline" };
    });

    it("pushes nothing, says nothing and RECORDS nothing", async () => {
      await arrive(build(), PRIYA);
      expect(store.rows.size).toBe(0);
      expect(store.recordGreeting).not.toHaveBeenCalled();
      expect(store.recordSkipped).not.toHaveBeenCalled();
      expect(presented).toEqual([]);
    });

    it("the visitor is retried on the next sighting and greeted once a player is back", async () => {
      const s = build();
      await arrive(s, PRIYA);
      screen = { kind: "idle" };
      await arrive(s, PRIYA);

      expect(presented).toHaveLength(1);
      expect(store.get(PRIYA, DAY)?.kind).toBe("named");
    });

    it("logs at most once per visitor per 5 minutes", async () => {
      const s = build();
      for (let i = 0; i < 4; i++) await arrive(s, PRIYA);
      const lines = () => logs().filter((l) => l.includes("screen offline — not greeted yet"));
      expect(lines()).toHaveLength(1);
      expect(lines()[0]).toContain("Priya");

      await arrive(s, UNKNOWN);
      expect(lines()).toHaveLength(2); // a different visitor has its own allowance

      clock += 5 * 60_000 + 1;
      await arrive(s, PRIYA);
      expect(lines()).toHaveLength(3);
    });

    it("a rename or merge while offline is not recorded either", async () => {
      const s = build();
      await s.onVisitorRenamed(PRIYA);
      await settle();
      await s.onVisitorMerged(ARJUN);
      await settle();
      expect(store.rows.size).toBe(0);
    });

    it("counts them for the status endpoint", async () => {
      const s = build();
      await arrive(s, PRIYA);
      expect(s.status().counters.offlineSkipped).toBe(1);
    });
  });

  describe("speech-safe names", () => {
    const say = async (raw: string, env: Record<string, string> = {}) => {
      visitors[PRIYA] = { name: raw, firstSeen: new Date("2026-10-01T00:00:00Z") };
      presented = [];
      store.rows.clear();
      await arrive(build(env), PRIYA);
      return presented[0]?.voiceText ?? null;
    };

    it("says the full name as entered by default", async () => {
      expect(await say("Priya Sharma")).toBe("Good afternoon, Priya Sharma. Welcome back.");
    });

    it("strips control characters and collapses whitespace", async () => {
      expect(await say("  Pri\u0007ya\u200b \n  Sharma\u0000 ")).toBe("Good afternoon, Pri ya Sharma. Welcome back.");
    });

    it("caps a long name at 40 characters", async () => {
      const text = (await say("A".repeat(120)))!;
      expect(text).toBe(`Good afternoon, ${"A".repeat(40)}. Welcome back.`);
    });

    it.each(["unknown", "Unknown", "TEST", "test", "Unknown-1a2b3c4d", "guest", "n/a", "   ", ""])(
      "treats %j as an unknown visitor: never said, follows GREET_UNKNOWN",
      async (raw) => {
        // GREET_UNKNOWN=generic would speak "<part of day>. Welcome." — and never the placeholder
        expect(await say(raw, { GREET_UNKNOWN: "generic" })).toBe("Good afternoon. Welcome.");
        expect(store.get(PRIYA, DAY)?.kind).toBe("generic");
      }
    );

    it("a placeholder with the default GREET_UNKNOWN=screen shows the screen but says nothing", async () => {
      expect(await say("Test")).toBeNull();
      expect(presented).toHaveLength(1); // the welcome screen is still shown
    });

    it("only an exact placeholder is filtered: 'Priya Test' and 'Testa' are real names", async () => {
      expect(await say("Priya Test")).toBe("Good afternoon, Priya Test. Welcome back.");
      expect(await say("Testa")).toBe("Good afternoon, Testa. Welcome back.");
    });

    it("GREET_NAME_MODE=first says only the first word", async () => {
      expect(await say("Priya Sharma", { GREET_NAME_MODE: "first" })).toBe("Good afternoon, Priya. Welcome back.");
    });

    it("GREET_NAME_MODE=first with a placeholder first word says no name (but still greets)", async () => {
      expect(await say("Test Priya", { GREET_NAME_MODE: "first" })).toBe("Good afternoon. Welcome.");
      expect(store.get(PRIYA, DAY)?.kind).toBe("named"); // identified, just not named aloud
    });

    it("GREET_NAME_MODE=none never says a name, yet the visitor is recorded as identified", async () => {
      expect(await say("Priya Sharma", { GREET_NAME_MODE: "none" })).toBe("Good afternoon. Welcome.");
      expect(store.get(PRIYA, DAY)?.kind).toBe("named");
    });

    it("a rename greeting follows the same rules", async () => {
      visitors[UNKNOWN] = { name: "Meera Kapoor", firstSeen: new Date(clock) };
      let s = build({ GREET_NAME_MODE: "first" });
      await s.onVisitorRenamed(UNKNOWN);
      await settle();
      expect(presented.at(-1)?.voiceText).toBe("Good afternoon, Meera. Nice to meet you.");

      store.rows.clear();
      s = build({ GREET_NAME_MODE: "none" });
      await s.onVisitorRenamed(UNKNOWN);
      await settle();
      expect(presented.at(-1)?.voiceText).toBe("Good afternoon. Nice to meet you.");
    });

    it("renaming someone to a placeholder greets nobody", async () => {
      visitors[UNKNOWN] = { name: "Test", firstSeen: new Date(clock) };
      await build().onVisitorRenamed(UNKNOWN);
      await settle();
      expect(presented).toEqual([]);
      expect(store.rows.size).toBe(0);
      expect(logs().some((l) => l.includes("name not speakable — no greeting"))).toBe(true);
    });
  });

  describe("decision logs", () => {
    it("greeted: one line with the text and who", async () => {
      await arrive(build(), PRIYA);
      expect(logs()).toContain('[greeting] greeted "Good afternoon, Priya. Welcome back." — Priya');
    });

    it("already greeted: logged once, however many sightings follow", async () => {
      const first = build();
      await arrive(first, PRIYA);
      const afterRestart = build(); // empty cache, DB says already greeted
      await arrive(afterRestart, PRIYA);
      afterRestart.invalidate(PRIYA);
      await arrive(afterRestart, PRIYA);
      expect(logs().filter((l) => l.includes("already greeted today"))).toHaveLength(1);
      expect(presented).toHaveLength(1);
    });

    it("repeated sightings of a greeted visitor stay completely silent (cache hits)", async () => {
      const s = build();
      await arrive(s, PRIYA);
      const before = info.mock.calls.length;
      for (let i = 0; i < 5; i++) await arrive(s, PRIYA);
      expect(info.mock.calls.length).toBe(before);
    });

    it("a uuid that is not in the visitor table is logged once", async () => {
      const s = build();
      const ghost = "99999999-9999-4999-8999-999999999999";
      for (let i = 0; i < 3; i++) await arrive(s, ghost);
      expect(logs().filter((l) => l.includes("unknown-visitor 99999999"))).toHaveLength(1);
    });
  });

  describe("status snapshot", () => {
    it("remembers the last greeting", async () => {
      const s = build();
      await arrive(s, PRIYA);
      expect(s.status().lastGreeting).toEqual({
        at: new Date(clock).toISOString(),
        text: "Good afternoon, Priya. Welcome back.",
        names: ["Priya"],
      });
      expect(s.status().breaker).toEqual({ paused: false, until: null, lastError: null });
    });

    it("exposes the breaker once it trips, including controller errors", async () => {
      const s = build();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      s.reportScreenError("greeting presentation", new Error("db unreachable"));
      const status = s.status();
      expect(status.breaker.paused).toBe(true);
      expect(status.breaker.lastError).toContain("db unreachable");
      expect(status.counters.errors).toBe(1);
      expect(status.breaker.until).toBe(new Date(clock + 5 * 60_000).toISOString());

      s.reportScreenError("another", new Error("again")); // already paused: stays quiet
      expect(s.status().counters.errors).toBe(1);
    });
  });
});
