import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ScreenController,
  isIdleState,
  WHITEBOARD_WATCH_INTERVAL_MS,
  WHITEBOARD_WATCH_MAX_MS,
  type GreetingPresentation,
  type GreetingRequest,
  type ScreenDeps,
} from "../src/services/greeting/screen.js";
import type { GreetingVoice } from "../src/services/greeting/voice.js";

const WELCOME = "welcome-exp";
const OTHER = "some-other-exp";
const DURATION_S = 20;
const STEP = WHITEBOARD_WATCH_INTERVAL_MS;

interface FakeScreen {
  kind: string | null;
  experienceId: string | null;
  /** what isScreenIdle would say */
  idle: boolean;
  /** the persisted "Stop" state */
  blanked: boolean;
  whiteboard: boolean;
  /** a real (non-preview) player is connected */
  online: boolean;
}

/** A fake main-screen that behaves like the DB: assigning an experience clears `blanked`. */
function makeScreen(initial: Partial<FakeScreen> = {}) {
  const state: FakeScreen = { kind: null, experienceId: null, idle: true, blanked: false, whiteboard: false, online: true, ...initial };
  const events: string[] = [];
  const deps: ScreenDeps = {
    // ONE combined read, like getScreenGreetingState. "idle" is expressed the way the DB does:
    // nothing assigned, or the current media IS the default media.
    getState: vi.fn(async () => ({
      kind: state.kind,
      currentMediaAssetId: state.kind === "media" ? (state.idle ? "default-media" : "other-media") : null,
      defaultMediaAssetId: "default-media",
      experienceId: state.experienceId,
      blanked: state.blanked,
      whiteboardActive: state.whiteboard,
    })),
    isWhiteboardDocLive: vi.fn(() => false),
    isOnline: vi.fn(() => state.online),
    getWelcomeExperienceId: vi.fn(async () => WELCOME),
    setExperience: vi.fn(async (_id, experienceId) => {
      events.push(`setExperience:${experienceId ?? "null"}`);
      state.kind = experienceId ? "experience" : null;
      state.experienceId = experienceId;
      state.idle = experienceId === null;
      state.blanked = false; // setScreenExperience() resets blanked in the DB
    }),
    setBlank: vi.fn(async (_id, blanked) => {
      events.push(`setBlank:${blanked}`);
      state.blanked = blanked;
    }),
    push: vi.fn(async () => void events.push("push")),
  };
  return { deps, state, events };
}

const makeVoice = () => {
  const spoken: string[] = [];
  const voice: GreetingVoice = { kind: "off", speak: (t) => void spoken.push(t) };
  return { voice, spoken };
};

/** A greeting request whose two outcomes are observable. */
const makeRequest = (batch: GreetingPresentation | null) => {
  const onBusy = vi.fn(async () => undefined);
  const onOffline = vi.fn(async () => undefined);
  const admit = vi.fn(async () => batch);
  return {
    request: { onBusy, onOffline, admit } as GreetingRequest & { onBusy: typeof onBusy; admit: typeof admit },
    onBusy,
    onOffline,
    admit,
  };
};

describe("ScreenController", () => {
  let info: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers();
    info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const greet: GreetingPresentation = { voiceText: "Good morning, Priya. Welcome back.", names: ["Priya"] };
  const make = (initial: Partial<FakeScreen> = {}) => {
    const s = makeScreen(initial);
    const v = makeVoice();
    return {
      ...s,
      ...v,
      controller: new ScreenController(s.deps, v.voice, DURATION_S),
    };
  };
  const present = async (t: ReturnType<typeof make>, batch: GreetingPresentation | null = greet) => {
    const r = makeRequest(batch);
    await t.controller.present(r.request);
    return r;
  };
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

  describe("idle", () => {
    it("admits, pushes the welcome screen, starts the revert timer, and speaks — without touching blank", async () => {
      const t = make();
      const r = await present(t);

      expect(r.admit).toHaveBeenCalledTimes(1);
      expect(r.onBusy).not.toHaveBeenCalled();
      expect(t.events).toEqual(["setExperience:welcome-exp", "push"]);
      expect(t.spoken).toEqual([greet.voiceText]);

      await advance(DURATION_S * 1000 + 1);
      expect(t.events).toEqual(["setExperience:welcome-exp", "push", "setExperience:null", "push"]); // no setBlank anywhere
    });

    it("the default media playing counts as idle (that is what isScreenIdle reports)", async () => {
      const t = make({ kind: "media", idle: true });
      await present(t);
      expect(t.events).toContain("setExperience:welcome-exp");
      expect(t.spoken).toHaveLength(1);
      t.controller.cancelTimer();
    });

    it("a screen-only batch (no voice line) pushes and says nothing", async () => {
      const t = make();
      await present(t, { voiceText: null, names: [] });
      expect(t.events).toEqual(["setExperience:welcome-exp", "push"]);
      expect(t.spoken).toEqual([]);
      t.controller.cancelTimer();
    });

    it("nobody left to greet (admit → null): the screen is not touched", async () => {
      const t = make();
      await present(t, null);
      expect(t.events).toEqual([]);
      expect(t.spoken).toEqual([]);
    });
  });

  describe("idle underneath, but blanked (operator pressed Stop)", () => {
    it("clears the overlay like the operator routes (assign, unblank, push), then speaks", async () => {
      const t = make({ blanked: true });
      await present(t);

      expect(t.events).toEqual(["setExperience:welcome-exp", "setBlank:false", "push"]);
      expect(t.spoken).toEqual([greet.voiceText]);
      t.controller.cancelTimer();
    });

    it("on revert, restores the snapshot: re-blanks — only because it is still on the welcome screen", async () => {
      const t = make({ blanked: true });
      await present(t);
      t.events.length = 0;

      await advance(DURATION_S * 1000 + 1);

      expect(t.events).toEqual(["setExperience:null", "push", "setBlank:true"]);
      expect(t.state).toMatchObject({ experienceId: null, blanked: true });
      expect(info).toHaveBeenCalledWith(expect.stringContaining("(screen re-blanked)"));
    });

    it("a second greeting while the welcome screen is up speaks only; the revert still re-blanks", async () => {
      const t = make({ blanked: true });
      await present(t);
      await advance(10_000);
      t.events.length = 0;

      await present(t, { voiceText: "Good morning. Welcome.", names: [] });
      expect(t.events).toEqual([]); // no push, no blank change
      expect(t.spoken).toHaveLength(2);

      await advance(10_001); // the original timer, not restarted
      expect(t.events).toEqual(["setExperience:null", "push", "setBlank:true"]);
    });

    it("forgets the snapshot once that welcome screen is over", async () => {
      const t = make({ blanked: true });
      await present(t);
      t.state.experienceId = OTHER;
      t.state.idle = false;
      await advance(DURATION_S * 1000 + 1); // skipped revert

      // later: the screen is back to plain idle, NOT blanked, and a new greeting arrives
      Object.assign(t.state, { kind: null, experienceId: null, idle: true, blanked: false });
      t.events.length = 0;
      await present(t);
      await advance(DURATION_S * 1000 + 1);

      expect(t.events).not.toContain("setBlank:true");
    });
  });

  it("not blanked before, but the operator pressed Stop during the welcome screen: the revert keeps it blanked", async () => {
    const t = make();
    await present(t);
    t.state.blanked = true; // Stop pressed mid-welcome (persisted by the blank route)
    t.events.length = 0;

    await advance(DURATION_S * 1000 + 1);
    expect(t.events).toEqual(["setExperience:null", "push", "setBlank:true"]);
  });

  describe("something else gets assigned: the welcome screen never comes back", () => {
    it("the revert timer does nothing", async () => {
      const t = make();
      await present(t);
      t.state.kind = "experience";
      t.state.experienceId = OTHER;
      t.state.idle = false;
      t.events.length = 0;

      await advance(DURATION_S * 1000 + 1);
      expect(t.events).toEqual([]);
      expect(info).toHaveBeenCalledWith("[greeting] welcome-screen no longer showing — revert skipped");
    });

    it("media assigned over the welcome screen: same", async () => {
      const t = make({ blanked: true });
      await present(t);
      Object.assign(t.state, { kind: "media", experienceId: null, idle: false });
      t.events.length = 0;

      await advance(DURATION_S * 1000 + 1);
      expect(t.events).toEqual([]); // not reverted, not re-blanked
    });
  });

  describe("a whiteboard opened over the welcome screen", () => {
    it("the timed revert stands down: logged, nothing touched (a push would erase the drawing)", async () => {
      const t = make();
      await present(t);
      t.state.whiteboard = true;
      t.events.length = 0;

      await advance(DURATION_S * 1000 + 1);

      expect(t.events).toEqual([]);
      expect(t.state.experienceId).toBe(WELCOME);
      expect(info).toHaveBeenCalledWith("[greeting] revert skipped (whiteboard live)");
      t.controller.cancelTimer();
    });

    it("while it is live nothing happens, however long; the moment it ends the pre-welcome state is restored", async () => {
      const t = make();
      await present(t);
      t.state.whiteboard = true;
      await advance(DURATION_S * 1000 + 1); // revert stands down, watch starts
      t.events.length = 0;

      await advance(STEP * 5); // still drawing
      expect(t.events).toEqual([]);

      t.state.whiteboard = false; // operator closes the whiteboard
      await advance(STEP);

      expect(t.events).toEqual(["setExperience:null", "push"]);
      expect(t.state.experienceId).toBeNull();
      expect(info).toHaveBeenCalledWith("[greeting] whiteboard ended — reverted welcome");

      t.events.length = 0;
      await advance(STEP * 5); // and the watch is over: nothing more happens
      expect(t.events).toEqual([]);
    });

    it("restores exactly what was there: a screen blanked before the welcome is blanked again", async () => {
      const t = make({ blanked: true });
      await present(t);
      t.state.whiteboard = true;
      await advance(DURATION_S * 1000 + 1);
      t.events.length = 0;

      t.state.whiteboard = false;
      await advance(STEP);

      expect(t.events).toEqual(["setExperience:null", "push", "setBlank:true"]);
      expect(info).toHaveBeenCalledWith("[greeting] whiteboard ended — reverted welcome (screen re-blanked)");
    });

    it("something else assigned meanwhile: the watch stands down for good and never reverts", async () => {
      const t = make();
      await present(t);
      t.state.whiteboard = true;
      await advance(DURATION_S * 1000 + 1);
      t.events.length = 0;

      // operator assigns other content (the whiteboard may or may not still be up)
      t.state.kind = "experience";
      t.state.experienceId = OTHER;
      t.state.idle = false;
      await advance(STEP);
      t.state.whiteboard = false;
      await advance(STEP * 5);

      expect(t.events).toEqual([]); // the welcome screen never comes back, and nothing is reverted
    });

    it("gives up after an hour and leaves the screen to the operator", async () => {
      const t = make();
      await present(t);
      t.state.whiteboard = true;
      await advance(DURATION_S * 1000 + 1);
      t.events.length = 0;

      await advance(WHITEBOARD_WATCH_MAX_MS + STEP);
      expect(info).toHaveBeenCalledWith(expect.stringContaining("whiteboard watch gave up"));

      t.state.whiteboard = false;
      await advance(STEP * 3);
      expect(t.events).toEqual([]);
    });

    it("without a whiteboard the revert happens as usual", async () => {
      const t = make();
      await present(t);
      t.events.length = 0;
      await advance(DURATION_S * 1000 + 1);
      expect(t.events).toEqual(["setExperience:null", "push"]);
    });

    it("the startup revert is not blocked by a stale whiteboard flag (boot reset clears it)", async () => {
      const t = make({ kind: "experience", experienceId: WELCOME, idle: false, whiteboard: true });
      expect(await t.controller.revertStaleWelcomeOnStartup()).toBe(true);
      expect(t.events).toEqual(["setExperience:null", "push"]);
    });
  });

  it("startup revert (fresh process, snapshot unknown) goes to plain idle", async () => {
    const t = make({ kind: "experience", experienceId: WELCOME, idle: false, blanked: false });

    expect(await t.controller.revertStaleWelcomeOnStartup()).toBe(true);
    expect(t.events).toEqual(["setExperience:null", "push"]);
    expect(info).toHaveBeenCalledWith("[greeting] reverted stale welcome-screen on startup");
  });

  describe("welcome screen already showing", () => {
    it("speaks only: no push, and the timer is not restarted", async () => {
      const t = make();
      await present(t); // t=0
      await advance(15_000);
      t.events.length = 0;

      await present(t, { voiceText: "Good morning. Welcome.", names: [] }); // t=15s
      expect(t.events).toEqual([]);
      expect(t.spoken).toEqual([greet.voiceText, "Good morning. Welcome."]);

      await advance(5_001); // the ORIGINAL timer fires at t=20s
      expect(t.events).toEqual(["setExperience:null", "push"]);
    });

    it("a screen-only batch does nothing", async () => {
      const t = make();
      await present(t);
      t.events.length = 0;
      await present(t, { voiceText: null, names: [] });
      expect(t.events).toEqual([]);
      t.controller.cancelTimer();
    });
  });

  describe("busy: the request is told why; nothing is admitted, shown or said", () => {
    const expectBusy = async (t: ReturnType<typeof make>, reason: string) => {
      const r = await present(t);
      expect(r.onBusy).toHaveBeenCalledWith(reason);
      expect(r.admit).not.toHaveBeenCalled();
      expect(t.events).toEqual([]);
      expect(t.spoken).toEqual([]);
    };

    it("other content", async () => expectBusy(make({ kind: "experience", experienceId: OTHER, idle: false }), "content"));
    it("media that is not the default (muted or not)", async () => expectBusy(make({ kind: "media", idle: false }), "content"));
    it("blanked over other content", async () =>
      expectBusy(make({ kind: "experience", experienceId: OTHER, idle: false, blanked: true }), "blanked"));
    it("blanked over non-default media", async () => expectBusy(make({ kind: "media", idle: false, blanked: true }), "blanked"));
    it("a live whiteboard over idle content", async () => expectBusy(make({ whiteboard: true }), "whiteboard"));
    it("whiteboard wins over blanked when both apply", async () => expectBusy(make({ whiteboard: true, blanked: true }), "whiteboard"));

    it("blanked while the welcome screen is up (nobody can see or hear it over black)", async () => {
      const t = make();
      await present(t);
      t.state.blanked = true;
      t.events.length = 0;
      t.spoken.length = 0;

      const r = await present(t);
      expect(r.onBusy).toHaveBeenCalledWith("blanked");
      expect(t.events).toEqual([]);
      expect(t.spoken).toEqual([]);
      t.controller.cancelTimer();
    });

    it("a live whiteboard over the welcome screen", async () => {
      const t = make();
      await present(t);
      t.state.whiteboard = true;
      t.events.length = 0;
      t.spoken.length = 0;

      const r = await present(t);
      expect(r.onBusy).toHaveBeenCalledWith("whiteboard");
      expect(t.spoken).toEqual([]);
      t.controller.cancelTimer();
    });

    it("a screen-only batch is told too", async () => {
      const t = make({ kind: "experience", experienceId: OTHER, idle: false });
      const r = await present(t, { voiceText: null, names: [] });
      expect(r.onBusy).toHaveBeenCalledWith("content");
      expect(t.events).toEqual([]);
    });
  });

  it("no welcome-screen experience: the gate runs but nothing is shown, so nothing is said", async () => {
    const t = make();
    t.deps.getWelcomeExperienceId = vi.fn(async () => null);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const r = await present(t);

    expect(r.admit).toHaveBeenCalled();
    expect(t.events).toEqual([]);
    expect(t.spoken).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("skipped (counted as greeted)"));
  });

  it("a decision that throws is logged and does not break the ones after it", async () => {
    const t = make();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    (t.deps.getState as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db unreachable"));
    await expect(t.controller.present(makeRequest(greet).request)).resolves.toBeUndefined(); // swallowed and logged
    expect(error).toHaveBeenCalledWith(expect.stringContaining("greeting presentation failed"), expect.any(Error));
    expect(t.spoken).toEqual([]);

    await present(t); // the next one works normally
    expect(t.spoken).toEqual([greet.voiceText]);
    expect(t.events).toEqual(["setExperience:welcome-exp", "push"]);
    t.controller.cancelTimer();
  });

  describe("offline: no connected player", () => {
    it("shows nothing, says nothing, records nothing — only onOffline is called", async () => {
      const t = make({ online: false });
      const r = await present(t);

      expect(r.onOffline).toHaveBeenCalledTimes(1);
      expect(r.admit).not.toHaveBeenCalled();
      expect(r.onBusy).not.toHaveBeenCalled();
      expect(t.events).toEqual([]);
      expect(t.spoken).toEqual([]);
    });

    it("beats every other state, busy ones included", async () => {
      const t = make({ online: false, kind: "experience", experienceId: OTHER, idle: false, whiteboard: true, blanked: true });
      const r = await present(t);
      expect(r.onOffline).toHaveBeenCalledTimes(1);
      expect(r.onBusy).not.toHaveBeenCalled();
    });

    it("the next sighting, with a player connected, goes through normally", async () => {
      const t = make({ online: false });
      await present(t);
      t.state.online = true;
      const r = await present(t);
      expect(r.admit).toHaveBeenCalled();
      expect(t.events).toEqual(["setExperience:welcome-exp", "push"]);
      t.controller.cancelTimer();
    });

    it("a revert is not held up by the player disconnecting meanwhile", async () => {
      const t = make();
      await present(t);
      t.state.online = false;
      t.events.length = 0;
      await advance(DURATION_S * 1000 + 1);
      expect(t.events).toEqual(["setExperience:null", "push"]);
    });
  });

  describe("failures", () => {
    it("go to the error handler when one is given, instead of the console", async () => {
      const s = makeScreen();
      const onError = vi.fn();
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const controller = new ScreenController(s.deps, makeVoice().voice, DURATION_S, "main-screen", onError);
      (s.deps.getState as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db unreachable"));

      await controller.present(makeRequest(greet).request);

      expect(onError).toHaveBeenCalledWith("greeting presentation", expect.any(Error));
      expect(error).not.toHaveBeenCalled();
    });
  });
});

describe("isIdleState (must agree with isScreenIdle in @platform/db)", () => {
  const row = (over: Partial<NonNullable<Parameters<typeof isIdleState>[0]>>) => ({
    kind: null as string | null,
    currentMediaAssetId: null as string | null,
    defaultMediaAssetId: null as string | null,
    experienceId: null as string | null,
    blanked: false,
    whiteboardActive: false,
    ...over,
  });

  it.each([
    ["no such screen", undefined, false],
    ["nothing assigned", row({}), true],
    ["nothing assigned, but a default media exists", row({ defaultMediaAssetId: "d" }), true],
    ["the default media is playing", row({ kind: "media", currentMediaAssetId: "d", defaultMediaAssetId: "d" }), true],
    ["other media is playing", row({ kind: "media", currentMediaAssetId: "x", defaultMediaAssetId: "d" }), false],
    ["media playing, no default media set", row({ kind: "media", currentMediaAssetId: "x" }), false],
    ["an experience", row({ kind: "experience", experienceId: "e" }), false],
  ])("%s -> idle=%s", (_label, state, idle) => {
    expect(isIdleState(state)).toBe(idle);
  });
});
