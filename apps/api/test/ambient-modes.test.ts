import { describe, it, expect, vi, beforeEach } from "vitest";

const mockModes = [
  { key: "pre_entry", label: "Pre-entry", position: 0, color: "#FFF3E0", brightness: 70, stripOn: true },
  { key: "entry", label: "Entry", position: 1, color: "#FFF3E0", brightness: 80, stripOn: true },
  { key: "meeting", label: "Meeting", position: 2, color: "#FFF3E0", brightness: 85, stripOn: true },
  { key: "presentation", label: "Presentation", position: 3, color: "#100073", brightness: 15, stripOn: false },
];

const light = (id: string, deviceId: string, name: string) => ({
  id,
  deviceId,
  type: "light",
  name,
  state: { on: false, brightness: 100, white: 255 },
  config: { driver: "casambi", targetId: 1 },
});
const mockDevices = [
  light("dev-f0", "casambi-light-27", "Stretch Fabric 0"),
  light("dev-f1", "casambi-light-28", "Stretch Fabric 1"),
  light("dev-strip", "casambi-light-23", "Strip Light"),
  { id: "dev-ac", deviceId: "ac-1", type: "ir", name: "Experience Centre AC", state: {}, config: { driver: "ir", irDevice: "ac" } },
  { id: "dev-relax", deviceId: "scene-relax", type: "scene", name: "Relax", state: {}, config: { driver: "scene", targets: {} } },
];

const { listDevices, getDevice, listAmbientModes, getAmbientMode } = vi.hoisted(() => ({
  listDevices: vi.fn(),
  getDevice: vi.fn(),
  listAmbientModes: vi.fn(),
  getAmbientMode: vi.fn(),
}));

vi.mock("@platform/db", () => ({
  listDevices,
  getDevice,
  listAmbientModes,
  getAmbientMode,
  listScreens: vi.fn(),
  listExperiences: vi.fn(),
  listMediaAssets: vi.fn(),
  setScreenExperience: vi.fn(),
  setScreenMedia: vi.fn(),
  setScreenBlanked: vi.fn(),
  advanceScreenQueue: vi.fn(),
}));

const { applyLightState, applyIrCommand, getIrDriver, triggerMeshScene } = vi.hoisted(() => ({
  applyLightState: vi.fn(),
  applyIrCommand: vi.fn(),
  getIrDriver: vi.fn(),
  triggerMeshScene: vi.fn(),
}));

vi.mock("../src/services/devices.js", () => ({
  applyLightState,
  applyIrCommand,
  getIrDriver,
  getDeviceDriver: vi.fn(),
  getCasambiDriver: () => ({ triggerMeshScene }),
}));

vi.mock("../src/ws/gateway.js", () => ({
  clearTakeoverFlag: vi.fn(),
  setScreenBlankState: vi.fn(),
  sendCommandToScreen: vi.fn().mockReturnValue(1),
}));

vi.mock("../src/routes/screens.js", () => ({
  pushScreenContent: vi.fn().mockResolvedValue(undefined),
}));

import { planAmbientMode, applyAmbientMode, resolveAmbientMode, whiteChannelFor } from "../src/services/ambient-modes.js";
import { runDeviceCommand, listVoiceDevices } from "../src/services/voice-actions.js";
import { resolveLightColor } from "../src/services/light-colors.js";

const byKey = (key: string) => mockModes.find((m) => m.key === key)!;

beforeEach(() => {
  vi.clearAllMocks();
  listDevices.mockResolvedValue(mockDevices);
  getDevice.mockImplementation(async (id: string) => mockDevices.find((d) => d.id === id) ?? null);
  listAmbientModes.mockResolvedValue(mockModes);
  getAmbientMode.mockImplementation(async (key: string) => byKey(key) ?? null);
  applyLightState.mockImplementation(async (d: any, patch: any) => ({ ...d, state: { ...d.state, ...patch } }));
  triggerMeshScene.mockResolvedValue(undefined);
  getIrDriver.mockReturnValue({});
  applyIrCommand.mockResolvedValue(undefined);
});

describe("planAmbientMode", () => {
  const lights = mockDevices.filter((d) => d.type === "light") as any[];

  it("warm white modes recall each group's warm scene and set the brightness", () => {
    const plan = planAmbientMode(byKey("entry"), lights);
    const fabric = plan.find((p) => p.group === "Stretch Fabric")!;
    const strip = plan.find((p) => p.group === "Strip Light")!;
    expect(fabric.members).toHaveLength(2);
    expect(fabric.scenes).toEqual([1]);
    expect(strip.scenes).toEqual([3]);
    for (const step of [fabric, strip]) {
      expect(step.state).toEqual({ on: true, brightness: 80, color: "#FFF3E0", white: 255 });
    }
  });

  it("presentation is #100073 at 15% on the fabrics with the strip light off", () => {
    const plan = planAmbientMode(byKey("presentation"), lights);
    const fabric = plan.find((p) => p.group === "Stretch Fabric")!;
    const strip = plan.find((p) => p.group === "Strip Light")!;
    // Colour scene, and white explicitly zero so a stale warm white can't wash the colour out.
    expect(fabric.scenes).toEqual([2]);
    expect(fabric.state).toEqual({ on: true, brightness: 15, color: "#100073", white: 0 });
    expect(strip.scenes).toEqual([]);
    expect(strip.state).toEqual({ on: false });
  });

  it("derives the white channel like the driver: whites to W, saturated colours to RGB", () => {
    expect(whiteChannelFor("#FFF3E0")).toBe(255);
    expect(whiteChannelFor("#FFFFFF")).toBe(255);
    expect(whiteChannelFor("#100073")).toBe(0);
    expect(whiteChannelFor("#00FF00")).toBe(0);
    expect(whiteChannelFor("nonsense")).toBe(0);
  });

  it("uses each mode's own brightness", () => {
    const level = (key: string) => planAmbientMode(byKey(key), lights)[0]!.state.brightness;
    expect([level("pre_entry"), level("entry"), level("meeting")]).toEqual([70, 80, 85]);
  });
});

describe("applyAmbientMode", () => {
  it("recalls the scenes before setting the lights, and reports the count", async () => {
    const result = await applyAmbientMode(byKey("pre_entry") as any, { settleMs: 0 });
    expect(result).toEqual({ applied: 3, failed: 0 });
    expect(triggerMeshScene.mock.calls.map((c) => c[0]).sort()).toEqual([1, 3]);
    expect(applyLightState).toHaveBeenCalledTimes(3);
    const lastScene = Math.max(...triggerMeshScene.mock.invocationCallOrder);
    const firstLight = Math.min(...applyLightState.mock.invocationCallOrder);
    expect(lastScene).toBeLessThan(firstLight);
  });

  it("presentation switches the strip off without recalling its scene", async () => {
    await applyAmbientMode(byKey("presentation") as any, { settleMs: 0 });
    expect(triggerMeshScene.mock.calls.map((c) => c[0])).toEqual([2]);
    const strip = applyLightState.mock.calls.find((c) => c[0].id === "dev-strip")!;
    expect(strip[1]).toEqual({ on: false });
  });

  it("leaves out lights outside the voice agent's scope", async () => {
    const result = await applyAmbientMode(byKey("entry") as any, {
      settleMs: 0,
      allowedDeviceIds: new Set(["dev-strip"]),
    });
    expect(result.applied).toBe(1);
    expect(applyLightState.mock.calls.map((c) => c[0].id)).toEqual(["dev-strip"]);
  });

  it("counts a failed scene recall as failed lights and does not touch them", async () => {
    triggerMeshScene.mockRejectedValue(new Error("mesh offline"));
    const result = await applyAmbientMode(byKey("entry") as any, { settleMs: 0 });
    expect(result).toEqual({ applied: 0, failed: 3 });
    expect(applyLightState).not.toHaveBeenCalled();
  });
});

describe("resolveAmbientMode", () => {
  it("matches each mode however it is said", async () => {
    for (const [said, key] of [
      ["entry mode", "entry"],
      ["Entry", "entry"],
      ["pre-entry mode", "pre_entry"],
      ["pre entry", "pre_entry"],
      ["preentry", "pre_entry"],
      ["meeting mode", "meeting"],
      ["presentation mode", "presentation"],
    ] as const) {
      expect((await resolveAmbientMode(said))?.key).toBe(key);
    }
  });

  it("never lets 'entry' match 'pre-entry', and rejects unknown names", async () => {
    expect((await resolveAmbientMode("entry"))?.key).not.toBe("pre_entry");
    expect(await resolveAmbientMode("party mode")).toBeNull();
    expect(await resolveAmbientMode("")).toBeNull();
  });
});

describe("Travis", () => {
  it("'meeting mode' applies the mode to the lights only", async () => {
    const res = await runDeviceCommand({ action: "ambient_mode", target: "meeting mode" }, "ADMIN");
    expect(res.message).toBe("Meeting mode is on.");
    expect(res.resolvedTarget).toBe("Meeting mode");
    expect(applyLightState).toHaveBeenCalledTimes(3);
    expect(applyLightState.mock.calls[0]![1]).toMatchObject({ brightness: 85 });
    expect(applyIrCommand).not.toHaveBeenCalled();
  });

  it("asks which mode when it can't find one, listing only the real ones", async () => {
    await expect(runDeviceCommand({ action: "ambient_mode", target: "party mode" }, "ADMIN")).rejects.toThrow(
      /Pre-entry, Entry, Meeting, Presentation/
    );
    expect(applyLightState).not.toHaveBeenCalled();
  });

  it("'hi' (good_morning) brings the lights up in pre-entry mode and turns the AC on", async () => {
    const res = await runDeviceCommand({ action: "good_morning" }, "ADMIN");
    expect(res.message).toContain("pre-entry mode");
    expect(res.message).toContain("the AC");
    expect(applyLightState.mock.calls.every((c) => c[1].brightness === 70 && c[1].color === "#FFF3E0")).toBe(true);
    expect(applyIrCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: "dev-ac" }),
      expect.anything(),
      expect.objectContaining({ command: "power_on" })
    );
  });

  it("'hi' still turns the lights and AC on if the modes table isn't available", async () => {
    listAmbientModes.mockRejectedValue(new Error('relation "ambient_mode" does not exist'));
    const res = await runDeviceCommand({ action: "good_morning" }, "ADMIN");
    expect(res.message).toContain("3 lights");
    expect(applyLightState).toHaveBeenCalledTimes(3);
    expect(applyIrCommand).toHaveBeenCalled();
  });

  it("no longer offers the old saved scenes", async () => {
    const names = (await listVoiceDevices()).map((d) => d.name);
    expect(names).not.toContain("Relax");
    expect(names).toContain("tusker L1");
  });
});

describe("colours by voice", () => {
  it("turns colour names into the hex the lights are driven with", () => {
    for (const [said, hex] of [
      ["blue", "#0000FF"],
      ["Blue light", "#0000FF"],
      ["red", "#FF0000"],
      ["green", "#00FF00"],
      ["warm white", "#FFF3E0"],
      ["purple", "#800080"],
      ["#100073", "#100073"],
      ["100073", "#100073"],
      ["#f0f", "#FF00FF"],
    ] as const) {
      expect(resolveLightColor(said)).toBe(hex);
    }
    expect(resolveLightColor("pink")).toBeNull();
    expect(resolveLightColor("")).toBeNull();
  });

  it("'tusker L1 blue' sends #0000FF on the colour LEDs and puts tusker L2 back as it was", async () => {
    const res = await runDeviceCommand({ action: "lights_set", target: "tusker L1", color: "blue" }, "ADMIN");
    expect(res.resolvedTarget).toBe("tusker L1");
    // The fabrics' colour scene, so RGB is visible at all.
    expect(triggerMeshScene.mock.calls.map((c) => c[0])).toEqual([2]);
    const f0 = applyLightState.mock.calls.find((c) => c[0].id === "dev-f0")!;
    expect(f0[1]).toMatchObject({ on: true, color: "#0000FF", white: 0 });
    // The scene recall would have switched tusker L2 on; it is restored to its prior (off) state.
    const f1 = applyLightState.mock.calls.find((c) => c[0].id === "dev-f1")!;
    expect(f1[1]).toMatchObject({ on: false });
    expect(f1[1].color).toBeUndefined();
    // Nothing else was touched.
    expect(applyLightState.mock.calls.some((c) => c[0].id === "dev-strip")).toBe(false);
  });

  it("warm white recalls the white-LED scene and uses the white channel", async () => {
    await runDeviceCommand({ action: "lights_set", target: "tusker edge", color: "warm white" }, "ADMIN");
    expect(triggerMeshScene.mock.calls.map((c) => c[0])).toEqual([3]);
    const strip = applyLightState.mock.calls.find((c) => c[0].id === "dev-strip")!;
    expect(strip[1]).toMatchObject({ color: "#FFF3E0", white: 255 });
  });

  it("confirms a colour request with the colour, not the light's brightness", async () => {
    const res = await runDeviceCommand({ action: "lights_set", target: "tusker edge", color: "warm white" }, "ADMIN");
    expect(res.message).toMatch(/tusker edge is now warm white\.$/);
    expect(res.message).not.toMatch(/%/);
  });

  it("refuses a colour it can't show instead of silently setting none", async () => {
    await expect(
      runDeviceCommand({ action: "lights_set", target: "tusker L1", color: "pink" }, "ADMIN")
    ).rejects.toThrow(/don't have a colour called "pink".*red, green, blue/);
    expect(applyLightState).not.toHaveBeenCalled();
    expect(triggerMeshScene).not.toHaveBeenCalled();
  });

  it("does not touch scenes for a plain brightness change", async () => {
    await runDeviceCommand({ action: "lights_set", target: "tusker L1", brightness: 40 }, "ADMIN");
    expect(triggerMeshScene).not.toHaveBeenCalled();
    expect(applyLightState).toHaveBeenCalledTimes(1);
  });
});
