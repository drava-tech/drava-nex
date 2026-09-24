import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDevices = [
  {
    id: "dev-edge",
    deviceId: "casambi-light-23",
    type: "light",
    name: "Strip Light",
    state: { on: false, brightness: 100 },
    config: { driver: "casambi", targetId: 23 },
  },
  {
    id: "dev-l1",
    deviceId: "casambi-light-27",
    type: "light",
    name: "Stretch Fabric 0",
    state: { on: false, brightness: 100 },
    config: { driver: "casambi", targetId: 27 },
  },
  {
    id: "dev-l2",
    deviceId: "casambi-light-28",
    type: "light",
    name: "Stretch Fabric 1",
    state: { on: false, brightness: 100 },
    config: { driver: "casambi", targetId: 28 },
  },
  {
    id: "dev-ac",
    deviceId: "d7b20d1b6760571b8b0cnw",
    type: "ir",
    name: "Experience Centre AC",
    state: {},
    config: { driver: "ir", irDevice: "ac" },
  },
  {
    id: "dev-tv",
    deviceId: "d7d74af8f0b7a3a5c24ca6",
    type: "ir",
    name: "TV",
    state: {},
    config: { driver: "ir", irDevice: "tv", categoryId: 2, remoteIndex: 692 },
  },
  {
    id: "dev-soundbar",
    deviceId: "d746e7d41e962b00dd0jhl",
    type: "ir",
    name: "Soundbar",
    state: {},
    config: { driver: "ir", irDevice: "soundbar", categoryId: 7, remoteIndex: 417259975 },
  },
];

const mockScreens = [
  {
    screenId: "main-screen",
    screenName: "tv-86inch",
    blanked: false,
    currentContentKind: "experience",
    experienceName: "Human Aping",
  },
  {
    screenId: "screen-2",
    screenName: "kiosk",
    blanked: false,
    currentContentKind: null,
  },
];

const mockExperiences = [
  { id: "exp-1", title: "Human Aping" },
  { id: "exp-2", title: "Flight Simulation" },
];

const {
  listDevices,
  getDevice,
  listScreens,
  listExperiences,
  listMediaAssets,
  setScreenExperience,
  setScreenMedia,
  setScreenBlanked,
  advanceScreenQueue,
} = vi.hoisted(() => ({
  listDevices: vi.fn(),
  getDevice: vi.fn(),
  listScreens: vi.fn(),
  listExperiences: vi.fn(),
  listMediaAssets: vi.fn(),
  setScreenExperience: vi.fn(),
  setScreenMedia: vi.fn(),
  setScreenBlanked: vi.fn(),
  advanceScreenQueue: vi.fn(),
}));

vi.mock("@platform/db", () => ({
  listDevices,
  getDevice,
  listScreens,
  listExperiences,
  listMediaAssets,
  setScreenExperience,
  setScreenMedia,
  setScreenBlanked,
  advanceScreenQueue,
}));

const { applyLightState, applyIrCommand, getIrDriver } = vi.hoisted(() => ({
  applyLightState: vi.fn(),
  applyIrCommand: vi.fn(),
  getIrDriver: vi.fn(),
}));

vi.mock("../src/services/devices.js", () => ({
  applyLightState,
  applyIrCommand,
  getIrDriver,
  getDeviceDriver: vi.fn(),
  getCasambiDriver: vi.fn(),
}));

vi.mock("../src/ws/gateway.js", () => ({
  clearTakeoverFlag: vi.fn(),
  setScreenBlankState: vi.fn(),
  sendCommandToScreen: vi.fn().mockReturnValue(1),
  getAudioStatus: vi.fn().mockReturnValue({ volume: 50, muted: false, device: "Test Audio" }),
  sendAudioCommand: vi.fn().mockReturnValue(true),
}));

vi.mock("../src/routes/screens.js", () => ({
  pushScreenContent: vi.fn().mockResolvedValue(undefined),
}));

import { runDeviceCommand, runScreenCommand, listVoiceDevices, listVoiceScreens } from "../src/services/voice-actions.js";

describe("Tusker Naming Conventions Resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDevices.mockResolvedValue(mockDevices);
    getDevice.mockImplementation(async (id: string) => mockDevices.find((d) => d.id === id || d.deviceId === id) ?? null);
    listScreens.mockResolvedValue(mockScreens);
    listExperiences.mockResolvedValue(mockExperiences);
    listMediaAssets.mockResolvedValue({ items: [] });
    applyLightState.mockImplementation(async (d: any, patch: any) => ({
      ...d,
      state: { ...d.state, ...patch },
    }));
    getIrDriver.mockReturnValue({});
    applyIrCommand.mockResolvedValue(undefined);
  });

  describe("Light Control", () => {
    it("resolves tusker edge (Casambi unit 23)", async () => {
      const res1 = await runDeviceCommand({ target: "tusker edge", action: "lights_on" }, "ADMIN");
      expect(res1.resolvedTarget).toBe("tusker edge");
      expect(applyLightState).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "casambi-light-23" }),
        expect.objectContaining({ on: true })
      );
    });

    it("resolves tusker L1 and tusker L2 individually", async () => {
      const res1 = await runDeviceCommand({ target: "tusker L1", action: "lights_on" }, "ADMIN");
      expect(res1.resolvedTarget).toBe("tusker L1");
      expect(applyLightState).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "casambi-light-27" }),
        expect.objectContaining({ on: true })
      );

      const res2 = await runDeviceCommand({ target: "tusker L2", action: "lights_on" }, "ADMIN");
      expect(res2.resolvedTarget).toBe("tusker L2");
      expect(applyLightState).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "casambi-light-28" }),
        expect.objectContaining({ on: true })
      );
    });

    it("resolves tusker L3 to both tusker L1 and tusker L2 together", async () => {
      const res = await runDeviceCommand({ target: "tusker L3", action: "lights_on" }, "ADMIN");
      expect(res.resolvedTarget).toBe("tusker L3");
      expect(res.message).toContain("tusker L3 is now on");
      expect(applyLightState).toHaveBeenCalledTimes(2);
      expect(applyLightState).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "casambi-light-27" }),
        expect.objectContaining({ on: true })
      );
      expect(applyLightState).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "casambi-light-28" }),
        expect.objectContaining({ on: true })
      );
    });

    it("turns tusker L3 off", async () => {
      const res = await runDeviceCommand({ target: "tusker L3", action: "lights_off" }, "ADMIN");
      expect(res.resolvedTarget).toBe("tusker L3");
      expect(res.message).toMatch(/tusker L3 is (already|now) off/);
      expect(applyLightState).toHaveBeenCalledTimes(2);
    });

    it("reports status for tusker L3 fixture group", async () => {
      const res = await runDeviceCommand({ target: "tusker L3", action: "status" }, "ADMIN");
      expect(res.resolvedTarget).toBe("tusker L3");
      expect(res.message).toContain("tusker L1");
      expect(res.message).toContain("tusker L2");
    });
  });

  describe("AC Control", () => {
    it("resolves tusker ac by new name and legacy aliases", async () => {
      const res1 = await runDeviceCommand(
        { target: "tusker ac", action: "ac_command", command: "power_on" },
        "ADMIN"
      );
      expect(res1.resolvedTarget).toBe("Experience Centre AC");
      expect(applyIrCommand).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "d7b20d1b6760571b8b0cnw" }),
        expect.anything(),
        expect.objectContaining({ command: "power_on" })
      );

      const res2 = await runDeviceCommand(
        { target: "the ac", action: "ac_command", command: "set_temperature", params: { temperature: 24 } },
        "ADMIN"
      );
      expect(res2.resolvedTarget).toBe("Experience Centre AC");

      const res3 = await runDeviceCommand(
        { target: "air conditioner", action: "ac_command", command: "power_off" },
        "ADMIN"
      );
      expect(res3.resolvedTarget).toBe("Experience Centre AC");
    });
  });

  describe("TV and Soundbar Hardware Control", () => {
    it("resolves tusker 86 and TV aliases to the TV IR device", async () => {
      // Voice command targeting tusker 86 for volume
      const res1 = await runDeviceCommand(
        { target: "tusker 86", action: "ac_command", command: "Volume Up" },
        "ADMIN",
        new Set(["dev-tv", "dev-soundbar"])
      );
      expect(res1.resolvedTarget).toBe("TV");
      expect(applyIrCommand).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "d7d74af8f0b7a3a5c24ca6" }),
        expect.anything(),
        expect.objectContaining({ command: "Volume Up" })
      );

      // Voice command targeting the tv
      const res2 = await runDeviceCommand(
        { target: "the tv", action: "ac_command", command: "Volume Down" },
        "ADMIN",
        new Set(["dev-tv", "dev-soundbar"])
      );
      expect(res2.resolvedTarget).toBe("TV");
    });

    // The soundbar makes the sound, but its own remote is unreachable through
    // the Tuya project — the CMS drives it through the TV's remote.
    it("routes soundbar / speaker / untargeted volume through the TV's remote", async () => {
      for (const target of ["Soundbar", "the speaker", undefined]) {
        applyIrCommand.mockClear();
        const res = await runDeviceCommand(
          { target, action: "ac_command", command: "Volume Up" },
          "ADMIN",
          new Set(["dev-tv"]) // the soundbar is deliberately not in scope
        );
        expect(res.resolvedTarget).toBe("TV");
        expect(applyIrCommand).toHaveBeenCalledTimes(1);
        expect(applyIrCommand).toHaveBeenCalledWith(
          expect.objectContaining({ deviceId: "d7d74af8f0b7a3a5c24ca6" }),
          expect.anything(),
          expect.objectContaining({ command: "Volume Up" })
        );
      }
    });

    it("presses volume the requested number of times and reports only that", async () => {
      const res = await runDeviceCommand(
        { target: "the TV", action: "ac_command", command: "Volume Up", params: { times: 3 } },
        "ADMIN"
      );
      expect(applyIrCommand).toHaveBeenCalledTimes(3);
      expect(res.message).toBe("Turned the volume up 3 steps on the TV.");
      expect(res.message).not.toMatch(/%/); // there is no level to read back
    });

    it("clamps the step count to between 1 and 10", async () => {
      await runDeviceCommand(
        { target: "the TV", action: "ac_command", command: "Volume Down", params: { times: 99 } },
        "ADMIN"
      );
      expect(applyIrCommand).toHaveBeenCalledTimes(10);

      applyIrCommand.mockClear();
      await runDeviceCommand(
        { target: "the TV", action: "ac_command", command: "Volume Down", params: { times: 0 } },
        "ADMIN"
      );
      expect(applyIrCommand).toHaveBeenCalledTimes(1);
    });

    it("does not claim success when the TV doesn't respond", async () => {
      applyIrCommand.mockRejectedValue(new Error("Tuya IR failed: boom"));
      await expect(
        runDeviceCommand({ target: "the TV", action: "ac_command", command: "Volume Up" }, "ADMIN")
      ).rejects.toThrow(/boom/);
    });

    it("says so when only some of the presses got through", async () => {
      applyIrCommand.mockResolvedValueOnce(undefined).mockRejectedValue(new Error("boom"));
      const res = await runDeviceCommand(
        { target: "the TV", action: "ac_command", command: "Volume Up", params: { times: 3 } },
        "ADMIN"
      );
      expect(res.message).toMatch(/Only 1 of 3/);
    });

    it("treats mute and unmute as the TV's single mute-toggle key", async () => {
      const res = await runDeviceCommand({ target: "the TV", action: "ac_command", command: "unmute" }, "ADMIN");
      expect(applyIrCommand).toHaveBeenCalledTimes(1);
      expect(applyIrCommand).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ command: "mute" })
      );
      expect(res.message).toMatch(/toggle/);
    });

    it("refuses volume when the TV isn't in this agent's scope", async () => {
      await expect(
        runDeviceCommand({ action: "ac_command", command: "Volume Up" }, "ADMIN", new Set(["dev-ac"]))
      ).rejects.toThrow(/reach the TV/);
    });
  });

  describe("Aliases are voice-only", () => {
    it("lists screens and devices by the user's alias, leaving ids untouched", async () => {
      const screens = await listVoiceScreens();
      expect(screens.map((s) => [s.screenId, s.screenName])).toEqual([
        ["main-screen", "tusker 86"],
        ["screen-2", "tusker 27"],
      ]);
      const devices = await listVoiceDevices();
      const byId = Object.fromEntries(devices.map((d) => [d.deviceId, d.name]));
      expect(byId["casambi-light-23"]).toBe("tusker edge");
      expect(byId["casambi-light-27"]).toBe("tusker L1");
      expect(byId["casambi-light-28"]).toBe("tusker L2");
      // No alias defined for these — they keep their real names.
      expect(byId["d7b20d1b6760571b8b0cnw"]).toBe("Experience Centre AC");
      expect(byId["d7d74af8f0b7a3a5c24ca6"]).toBe("TV");
    });

    it("reaches the lights only through their aliases, not their real names", async () => {
      for (const phrase of [
        "strip light",
        "strip",
        "edge",
        "stretch fabric 0",
        "stretch fabric zero",
        "stretch fabric 1",
        "stretch fabric",
        "fabric",
        "l1",
        "l3",
      ]) {
        applyLightState.mockClear();
        await expect(runDeviceCommand({ target: phrase, action: "lights_on" }, "ADMIN")).rejects.toThrow(
          /couldn't find exactly one device/
        );
        expect(applyLightState).not.toHaveBeenCalled();
      }
    });
  });

  describe("Screen Control", () => {
    it("resolves tusker 86 and pushes experience", async () => {
      const res = await runScreenCommand(
        { screen: "tusker 86", action: "assign_experience", content: "Human Aping" },
        "GUEST",
        new Set(["main-screen", "screen-2"])
      );
      expect(res.resolvedTarget).toBe("tusker 86");
      expect(res.resolvedContent).toBe("Human Aping");
      expect(setScreenExperience).toHaveBeenCalledWith("main-screen", "exp-1");
    });

    it("only accepts 'tusker 86' for the 86-inch screen, not its real name or other phrasings", async () => {
      for (const phrase of ["tv 86 inch", "tv-86inch", "86 inch", "86", "main screen", "tv 86"]) {
        await expect(
          runScreenCommand(
            { screen: phrase, action: "assign_experience", content: "Human Aping" },
            "GUEST",
            new Set(["main-screen", "screen-2"])
          )
        ).rejects.toThrow(/couldn't find exactly one screen/);
      }
    });

    it("resolves tusker 27, in digits or words, to screen-2", async () => {
      for (const phrase of ["tusker 27", "tusker twenty seven", "tusker twenty-seven"]) {
        const res = await runScreenCommand(
          { screen: phrase, action: "assign_experience", content: "Flight Simulation" },
          "GUEST",
          new Set(["main-screen", "screen-2"])
        );
        expect(res.resolvedTarget).toBe("tusker 27");
      }
    });

    it("treats spoken numbers and digits as identical", async () => {
      for (const phrase of ["tusker 86", "tusker eighty six", "tusker eighty-six"]) {
        const res = await runScreenCommand(
          { screen: phrase, action: "assign_experience", content: "Human Aping" },
          "GUEST",
          new Set(["main-screen", "screen-2"])
        );
        expect(res.resolvedTarget).toBe("tusker 86");
      }
      applyLightState.mockClear();
      await runDeviceCommand({ target: "tusker L one", action: "lights_on" }, "ADMIN");
      expect(applyLightState.mock.calls[0]![0]).toMatchObject({ deviceId: "casambi-light-27" });
    });

    it("only accepts 'tusker 27' as the spoken alias for the 27-inch screen", async () => {
      for (const phrase of ["screen 27", "screen twenty seven", "screen 2", "screen two", "27 inch", "27", "tv 2"]) {
        await expect(
          runScreenCommand(
            { screen: phrase, action: "assign_experience", content: "Flight Simulation" },
            "GUEST",
            new Set(["main-screen", "screen-2"])
          )
        ).rejects.toThrow(/couldn't find exactly one screen/);
      }
    });

    it("enforces allowedScreenIds scope correctly for tusker 27 / screen-2", async () => {
      // If screen-2 is not in allowed set, it should throw FORBIDDEN_SCOPE
      await expect(
        runScreenCommand(
          { screen: "tusker 27", action: "assign_experience", content: "Flight Simulation" },
          "GUEST",
          new Set(["main-screen"]) // screen-2 omitted
        )
      ).rejects.toThrow("This voice agent isn't permitted to control \"tusker 27\".");
    });
  });
});
