import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  listDevices: vi.fn(),
  setDeviceState: vi.fn(async (id: string, state: Record<string, unknown>) => ({ id, state })),
  listScreens: vi.fn(),
  listExperiences: vi.fn(),
  listMediaAssets: vi.fn(),
  setScreenExperience: vi.fn(),
  setScreenMedia: vi.fn(),
  setScreenBlanked: vi.fn(),
}));
const gateway = vi.hoisted(() => ({
  broadcastToCms: vi.fn(),
  clearTakeoverFlag: vi.fn(),
  sendCommandToScreen: vi.fn(() => 1),
  setScreenBlankState: vi.fn(),
}));
const deviceRoutes = vi.hoisted(() => ({
  applyLightState: vi.fn(async () => ({})),
  applyIrCommandToState: vi.fn((prev: Record<string, unknown>) => prev),
}));
const irDriver = vi.hoisted(() => ({ sendCommand: vi.fn(async () => {}) }));
const pushScreenContent = vi.hoisted(() => vi.fn(async () => null));
const setDoorLock = vi.hoisted(() => vi.fn(async () => {}));
const ambientModes = vi.hoisted(() => ({
  resolveAmbientMode: vi.fn(),
  applyAmbientMode: vi.fn(),
  listAmbientModes: vi.fn(),
}));

vi.mock("@platform/db", () => db);
vi.mock("../src/ws/gateway.js", () => gateway);
vi.mock("../src/routes/devices.js", () => deviceRoutes);
vi.mock("../src/routes/screens.js", () => ({ pushScreenContent }));
vi.mock("../src/services/devices.js", () => ({ getIrDriver: () => irDriver }));
vi.mock("../src/services/door-lock.js", () => ({ setDoorLock }));
vi.mock("../src/services/ambient-modes.js", () => ambientModes);

import { createVoiceControlRouter } from "../src/routes/voice-control.js";
import { matchByName, normalizeName } from "../src/services/voice-control.js";

const SECRET = "test-voice-control-secret";
const mqtt = {} as never;

function post(path: string, body: unknown, headers: Record<string, string> = { "x-travis-vc-key": SECRET }) {
  return createVoiceControlRouter(mqtt).request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const light = (id: string, name: string, state: Record<string, unknown> = {}) => ({ id, deviceId: id, name, type: "light", state, config: {} });
const ir = (id: string, name: string, irDevice: string) => ({ id, deviceId: id, name, type: "ir", state: {}, config: { driver: "ir", irDevice } });

beforeEach(() => {
  vi.clearAllMocks();
  process.env["TRAVIS_VC_KEY"] = SECRET;
  db.listDevices.mockResolvedValue([
    light("l1", "Strip Light", { brightness: 40 }),
    light("l2", "Stretch Fabric 0"),
    light("l3", "Stretch Fabric 1"),
    ir("ac1", "Experience Centre AC", "ac"),
    ir("tv1", "TV", "tv"),
    ir("sb1", "Soundbar", "soundbar"),
  ]);
  db.listScreens.mockResolvedValue([
    { screenId: "screen-2", screenName: "Screen 2", blanked: false },
    { screenId: "lobby", screenName: "Lobby Wall", blanked: true },
  ]);
  db.listExperiences.mockResolvedValue([{ id: "e1", title: "Welcome Tour" }]);
  db.listMediaAssets.mockResolvedValue({ items: [{ id: "m1", name: "Intro Reel" }, { id: "m2", name: "Intro Loop" }] });
});

describe("auth", () => {
  it("rejects a missing or wrong secret", async () => {
    expect((await post("/door", { action: "unlock" }, {})).status).toBe(401);
    expect((await post("/door", { action: "unlock" }, { "x-travis-vc-key": "nope" })).status).toBe(401);
    expect(setDoorLock).not.toHaveBeenCalled();
  });

  it("is disabled when TRAVIS_VC_KEY is unset", async () => {
    delete process.env["TRAVIS_VC_KEY"];
    expect((await post("/door", { action: "unlock" }, { "x-travis-vc-key": "" })).status).toBe(401);
  });

  it("validates the body", async () => {
    const res = await post("/ac", { action: "set_temp", temp: 45 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION");
  });
});

describe("names", () => {
  it("normalizes hyphens, case and digit boundaries", () => {
    expect(normalizeName("Screen-2")).toBe("screen 2");
    expect(normalizeName("TV86inch")).toBe("tv 86 inch");
  });

  it("matches exact first, else every name containing all spoken words", () => {
    const items = ["Stretch Fabric 0", "Stretch Fabric 1", "Strip Light"];
    expect(matchByName("strip light", items, (n) => [n])).toEqual(["Strip Light"]);
    expect(matchByName("stretch fabric", items, (n) => [n])).toEqual(["Stretch Fabric 0", "Stretch Fabric 1"]);
    expect(matchByName("kitchen", items, (n) => [n])).toEqual([]);
  });
});

describe("lights", () => {
  it("no target = every light", async () => {
    const res = await post("/lights", { action: "off" });
    expect(res.status).toBe(200);
    expect(deviceRoutes.applyLightState).toHaveBeenCalledTimes(3);
    expect(((await res.json()) as { data: { message: string } }).data.message).toBe("Turned off 3 lights.");
  });

  it("a spoken group name drives every matching fixture", async () => {
    await post("/lights", { action: "set", target: "stretch fabric lights", brightness: 50, color: "blue" });
    expect(deviceRoutes.applyLightState).toHaveBeenCalledTimes(2);
    expect(deviceRoutes.applyLightState).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Stretch Fabric 0" }),
      { on: true, brightness: 50, color: "#0000FF" }
    );
  });

  it("'on' restores the last brightness, or full if it was 0", async () => {
    await post("/lights", { action: "on" });
    const calls = deviceRoutes.applyLightState.mock.calls as unknown as Array<[{ name: string }, object]>;
    expect(calls.find(([d]) => d.name === "Strip Light")![1]).toEqual({ on: true });
    expect(calls.find(([d]) => d.name === "Stretch Fabric 0")![1]).toEqual({ on: true, brightness: 100 });
  });

  it("unknown names list the real ones; unknown colours list the options", async () => {
    const res = await post("/lights", { action: "on", target: "kitchen" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("Strip Light, Stretch Fabric 0, Stretch Fabric 1");
    const res2 = await post("/lights", { action: "set", color: "magenta" });
    expect(((await res2.json()) as { error: { message: string } }).error.message).toMatch(/colours are: red/);
    expect(deviceRoutes.applyLightState).not.toHaveBeenCalled();
  });
});

describe("AC and volume", () => {
  it("the only AC gets the IR command, state is folded and broadcast", async () => {
    const res = await post("/ac", { action: "set_temp", temp: 22, target: "AC" });
    expect(res.status).toBe(200);
    expect(irDriver.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "ac1" }), { command: "set_temp", params: { temp: 22 } });
    expect(db.setDeviceState).toHaveBeenCalled();
    expect(gateway.broadcastToCms).toHaveBeenCalledWith(expect.objectContaining({ type: "IR_STATE_UPDATE" }));
  });

  it("volume goes to the TV remote, pressed N times, and never states a level", async () => {
    const res = await post("/volume", { action: "down", times: 3 });
    const { data } = (await res.json()) as { data: { message: string } };
    expect(irDriver.sendCommand).toHaveBeenCalledTimes(3);
    expect(irDriver.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "tv1" }), { command: "Volume Down" });
    expect(data.message).toBe("Volume down, 3 steps.");
    expect(data.message).not.toMatch(/percent|%/);
  });

  it("mute is the single toggle key", async () => {
    await post("/volume", { action: "mute" });
    expect(irDriver.sendCommand).toHaveBeenCalledOnce();
    expect(irDriver.sendCommand).toHaveBeenCalledWith(expect.objectContaining({ id: "tv1" }), { command: "mute" });
  });
});

describe("door", () => {
  it("locks through the shared Home Assistant path", async () => {
    const res = await post("/door", { action: "lock" });
    expect(res.status).toBe(200);
    expect(setDoorLock).toHaveBeenCalledWith(mqtt, "locked", "voice-control");
  });

  it("replays a retried request instead of actuating twice", async () => {
    const router = createVoiceControlRouter(mqtt);
    const send = () =>
      router.request("/door", {
        method: "POST",
        headers: { "content-type": "application/json", "x-travis-vc-key": SECRET, "x-idempotency-key": "k-1" },
        body: JSON.stringify({ action: "unlock" }),
      });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect(setDoorLock).toHaveBeenCalledTimes(1);
  });
});

describe("screens and content", () => {
  it('"screen 2" resolves to screen-2; pause uses the CMS remote-command payload', async () => {
    await post("/screen", { action: "pause", screen: "screen 2" });
    expect(gateway.sendCommandToScreen).toHaveBeenCalledWith("screen-2", "MEDIA_SET_PAUSED", { paused: true });
  });

  it("stop = the CMS Stop (blank, persisted); play un-blanks a stopped screen", async () => {
    await post("/screen", { action: "stop", screen: "screen 2" });
    expect(db.setScreenBlanked).toHaveBeenCalledWith("screen-2", true);
    expect(gateway.setScreenBlankState).toHaveBeenCalledWith("screen-2", true);

    await post("/screen", { action: "play", screen: "lobby" });
    expect(db.setScreenBlanked).toHaveBeenCalledWith("lobby", false);
    expect(gateway.sendCommandToScreen).toHaveBeenCalledWith("lobby", "MEDIA_SET_PAUSED", { paused: false });
  });

  it("reports a screen that isn't connected", async () => {
    gateway.sendCommandToScreen.mockReturnValueOnce(0);
    const res = await post("/screen", { action: "play", screen: "screen 2" });
    expect(res.status).toBe(409);
  });

  it("content 'any': experience first, then media; pushes like the CMS", async () => {
    const res = await post("/content", { content: "welcome tour", screen: "lobby wall" });
    expect(res.status).toBe(200);
    expect(db.setScreenExperience).toHaveBeenCalledWith("lobby", "e1");
    expect(gateway.clearTakeoverFlag).toHaveBeenCalledWith("lobby");
    expect(gateway.setScreenBlankState).toHaveBeenCalledWith("lobby", false);
    expect(pushScreenContent).toHaveBeenCalledWith("lobby");

    await post("/content", { content: "intro reel", screen: "screen 2" });
    expect(db.setScreenMedia).toHaveBeenCalledWith("screen-2", "m1");
  });

  it("ambiguous content asks instead of guessing", async () => {
    const res = await post("/content", { content: "intro", screen: "screen 2" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe('"intro" could be Intro Reel or Intro Loop. Which one?');
    expect(pushScreenContent).not.toHaveBeenCalled();
  });

  it("unknown screen lists the real screens", async () => {
    const res = await post("/screen", { action: "pause", screen: "kitchen" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain("Screen 2, Lobby Wall");
  });
});

describe("ambient modes", () => {
  it("activates an ambient mode and returns success", async () => {
    ambientModes.resolveAmbientMode.mockResolvedValue({ key: "meeting", label: "Meeting" });
    ambientModes.applyAmbientMode.mockResolvedValue({ applied: 3, failed: 0 });
    const res = await post("/ambient-mode", { mode: "meeting" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data).toEqual({
      message: "Meeting mode activated.",
      targets: ["Meeting"],
    });
  });

  it("404s for unknown ambient mode with list of available modes", async () => {
    ambientModes.resolveAmbientMode.mockResolvedValue(null);
    ambientModes.listAmbientModes.mockResolvedValue([
      { key: "pre_entry", label: "Pre-entry" },
      { key: "meeting", label: "Meeting" },
    ]);
    const res = await post("/ambient-mode", { mode: "party" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error.message).toContain("Pre-entry, Meeting");
  });
});
