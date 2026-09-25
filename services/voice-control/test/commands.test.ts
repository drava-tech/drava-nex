import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRegistry, expandPhrase, loadRegistry } from "../src/commands/registry.js";
import { matchCommand, type CommandMatch } from "../src/commands/matcher.js";
import { resolveCommand } from "../src/commands/resolve.js";
import { normalize } from "../src/utils/text.js";

const registry = loadRegistry(join(import.meta.dirname, "..", "config", "commands.json"));
const options = { fuzzy: true, fuzzyThreshold: 0.82, minMatchConfidence: 0.75 };
const noDefaults = { lightTarget: null, acTarget: null, screen: null };

function match(text: string): CommandMatch {
  const r = matchCommand(text, registry, options);
  if (!r.ok) throw new Error(`"${text}" did not match: ${r.reason}`);
  return r;
}

function request(text: string, defaults = noDefaults) {
  const r = resolveCommand(match(text), defaults);
  if (r.kind !== "request") throw new Error(`"${text}" resolved to ${r.kind}`);
  return r.request;
}

describe("normalize", () => {
  it("converts number words and drops fillers", () => {
    expect(normalize("Set the lights to fifty percent")).toBe("set lights 50 percent");
    expect(normalize("set the AC to twenty two degrees")).toBe("set ac 22 degrees");
    expect(normalize("one hundred")).toBe("100");
    expect(normalize("a hundred percent")).toBe("100 percent");
    expect(normalize("set it to 30%")).toBe("set it 30 percent");
  });
});

describe("expandPhrase", () => {
  it("expands alternatives and optional words", () => {
    expect(expandPhrase("(turn|switch) on [the] lights").map((t) => t.join(" "))).toEqual([
      "turn on the lights",
      "turn on lights",
      "switch on the lights",
      "switch on lights",
    ]);
  });

  it("rejects unknown slots and malformed syntax", () => {
    expect(() => buildRegistry({ slots: {}, commands: [{ intent: "X", phrases: ["set {nope}"], reply: "x" }] })).toThrow(/Unknown slot/);
    expect(() => expandPhrase("(turn on")).toThrow(/Unclosed/);
  });
});

describe("spec examples", () => {
  it('"turn on the lights" -> LIGHT_ON', () => {
    const m = match("turn on the lights");
    expect(m.intent).toBe("LIGHT_ON");
    expect(m.method).toBe("exact");
    expect(request("turn on the lights")).toEqual({ endpoint: "lights", body: { action: "on" } });
  });

  it('"set the lights to 50 percent" -> LIGHT_BRIGHTNESS { brightness: 50 }', () => {
    const m = match("set the lights to fifty percent");
    expect(m.intent).toBe("LIGHT_BRIGHTNESS");
    expect(m.params).toEqual({ brightness: 50 });
    // No name = every light, like "turn on the lights".
    expect(request("set the lights to fifty percent")).toEqual({ endpoint: "lights", body: { action: "set", brightness: 50 } });
  });

  it('"set the AC to 22 degrees" -> AC_SET_TEMPERATURE { temperature: 22 }', () => {
    const m = match("set the AC to twenty two degrees");
    expect(m.intent).toBe("AC_SET_TEMPERATURE");
    expect(m.params).toEqual({ temperature: 22 });
    expect(request("set the AC to twenty two degrees")).toEqual({ endpoint: "ac", body: { action: "set_temp", temp: 22 } });
  });
});

describe("intents", () => {
  const cases: Array<[string, string, Record<string, unknown>?]> = [
    ["turn off the lights", "LIGHT_OFF"],
    ["lights off", "LIGHT_OFF"],
    ["turn on the lobby lights", "LIGHT_ON", { target: "lobby" }],
    ["set the lights to blue", "LIGHT_COLOR", { color: "blue" }],
    ["make the office lights warm white", "LIGHT_COLOR", { target: "office", color: "warm white" }],
    ["dim the lights to thirty percent", "LIGHT_BRIGHTNESS", { brightness: 30 }],
    ["turn on the AC", "AC_ON"],
    ["switch off the air conditioner", "AC_OFF"],
    ["set the AC to cool mode", "AC_SET_MODE", { mode: "cool" }],
    ["lock the door", "DOOR_LOCK"],
    ["unlock the front door", "DOOR_UNLOCK"],
    ["volume up", "VOLUME_UP"],
    ["turn the volume down by three", "VOLUME_DOWN", { steps: 3 }],
    ["set volume to forty", "SET_VOLUME", { volume: 40 }],
    ["mute", "MUTE"],
    ["turn off mute", "UNMUTE"],
    ["pause", "AUDIO_PAUSE"],
    ["stop the music", "AUDIO_STOP"],
    ["play music", "AUDIO_PLAY"],
    ["pause screen two", "SCREEN_PAUSE", { namedScreen: "screen 2" }],
    ["resume the lobby screen", "SCREEN_PLAY", { namedScreen: "lobby screen" }],
    ["stop screen one", "SCREEN_STOP", { namedScreen: "screen 1" }],
    ["pause the screen", "SCREEN_PAUSE", {}],
    ["play welcome video on screen two", "CONTENT_PLAY", { content: "welcome video", screen: "screen 2" }],
    ["play welcome video", "CONTENT_PLAY", { content: "welcome video" }],
    ["play the intro on the lobby screen", "CONTENT_PLAY", { content: "intro", screen: "lobby screen" }],
    ["show video intro reel on the lobby", "MEDIA_SELECT", { content: "intro reel", screen: "lobby" }],
    ["push product tour to screen three", "CONTENT_PUSH", { content: "product tour", namedScreen: "screen 3" }],
    ["play screen two", "SCREEN_PLAY", { namedScreen: "screen 2" }],
  ];
  it.each(cases)("%s -> %s", (text, intent, params) => {
    const m = match(text);
    expect(m.intent).toBe(intent);
    if (params) expect(m.params).toEqual(params);
  });

  it("passes names as spoken, with numbers as digits so the CMS matches e.g. screen-2", () => {
    expect(request("pause screen two").body).toEqual({ action: "pause", screen: "screen 2" });
  });
});

describe("parameters", () => {
  it("rejects out-of-range values instead of clamping", () => {
    expect(matchCommand("set the AC to 45 degrees", registry, options).ok).toBe(false);
    expect(matchCommand("set the lights to 150 percent", registry, options).ok).toBe(false);
  });

  it("sends volume steps as times, and omits times without steps", () => {
    expect(request("volume up by 3")).toEqual({ endpoint: "volume", body: { action: "up", times: 3 } });
    expect(request("volume up").body).toEqual({ action: "up" });
  });

  it("SET_VOLUME replies instead of calling the CMS, and states no level", () => {
    const r = resolveCommand(match("set volume to 40"), noDefaults);
    expect(r.kind).toBe("reply");
    if (r.kind === "reply") expect(r.text).not.toMatch(/\d|percent/);
  });
});

describe("targets", () => {
  it("asks instead of guessing when a screen isn't named", () => {
    expect(resolveCommand(match("pause"), noDefaults)).toEqual({
      kind: "ask",
      question: "Which screen is playing it?",
      slot: "screen",
    });
  });

  it("uses configured defaults when set", () => {
    const defaults = { lightTarget: "Main Hall", acTarget: "Daikin", screen: "Lobby" };
    expect(request("set the lights to 50 percent", defaults).body).toEqual({ action: "set", brightness: 50, target: "Main Hall" });
    expect(request("turn on the AC", defaults).body).toEqual({ action: "power_on", target: "Daikin" });
    expect(request("pause", defaults).body).toEqual({ action: "pause", screen: "Lobby" });
  });

  it("spoken target wins over the configured default", () => {
    const defaults = { lightTarget: "Main Hall", acTarget: null, screen: null };
    expect(request("set the office lights to 20 percent", defaults).body).toMatchObject({ target: "office" });
  });

  it("content: 'play' lets the API pick experience or media; 'show video' asks for media", () => {
    expect(request("play welcome on screen two")).toEqual({
      endpoint: "content",
      body: { kind: "any", content: "welcome", screen: "screen 2" },
    });
    expect(request("show video intro reel on the lobby").body).toEqual({ kind: "media", content: "intro reel", screen: "lobby" });
  });
});

describe("fuzzy matching", () => {
  it("accepts a close phrase", () => {
    const m = match("volume upp");
    expect(m.intent).toBe("VOLUME_UP");
    expect(m.method).toBe("fuzzy");
    expect(m.confidence).toBeGreaterThanOrEqual(0.75);
  });

  it('refuses a near tie between intents ("lights of": on or off?)', () => {
    const r = matchCommand("lights of", registry, options);
    expect(r).toMatchObject({ ok: false, reason: "ambiguous" });
  });

  it("corrects a misheard word in a slot phrase", () => {
    const m = match("set the lights brightnes to 40");
    expect(m.intent).toBe("LIGHT_BRIGHTNESS");
    expect(m.params).toEqual({ brightness: 40 });
  });

  it("never fuzzy-matches the door", () => {
    const r = matchCommand("unlok the door", registry, options);
    expect(r.ok && r.intent === "DOOR_UNLOCK").toBe(false);
  });

  it("rejects unrelated speech", () => {
    const r = matchCommand("what is the weather like today", registry, options);
    expect(r.ok).toBe(false);
  });

  it('rewrites Vosk\'s spelled-out "a c" to "ac"', () => {
    const m = match("turn on the a c");
    expect(m).toMatchObject({ intent: "AC_ON", method: "exact" });
  });

  it("drops one stray unknown leading word (real Vosk output after a pause)", () => {
    const m = match("that the a c to twenty two degrees");
    expect(m).toMatchObject({ intent: "AC_SET_TEMPERATURE", params: { temperature: 22 }, method: "fuzzy" });
    expect(m.confidence).toBeLessThan(1);
  });

  it("never drops a stray word into a door command", () => {
    const r = matchCommand("so unlock the door", registry, options);
    expect(r.ok && r.intent === "DOOR_UNLOCK").toBe(false);
  });

  it("does nothing with fuzzy disabled", () => {
    expect(matchCommand("volume upp", registry, { ...options, fuzzy: false }).ok).toBe(false);
  });
});

describe("greeting", () => {
  // 08:30 IST = 03:00 UTC, 14:00 IST = 08:30 UTC, 20:00 IST = 14:30 UTC
  const at = (utc: string) => new Date(`2026-09-25T${utc}:00Z`);

  it("answers by IST time, whatever greeting was said", () => {
    const m = match("good evening");
    expect(resolveCommand(m, noDefaults, at("03:00"))).toEqual({ kind: "reply", text: "Good morning!" });
    expect(resolveCommand(m, noDefaults, at("08:30"))).toEqual({ kind: "reply", text: "Good afternoon!" });
    expect(resolveCommand(match("good morning"), noDefaults, at("14:30"))).toEqual({ kind: "reply", text: "Good evening!" });
  });
});

describe("aliases", () => {
  it.each([
    ["turn on tusker edge", { action: "on", target: "Strip Light" }],
    ["turn off tusker l one", { action: "off", target: "Stretch Fabric 0" }],
    ["set tusker l two to fifty percent", { action: "set", brightness: 50, target: "Stretch Fabric 1" }],
    ["turn on the tusker l three lights", { action: "on", target: "Stretch Fabric" }],
    ["pause tusker twenty seven", { action: "pause", screen: "screen 2" }],
    ["play intro on tusker eighty six", { kind: "any", content: "intro", screen: "tv 86 inch" }],
  ])("%s", (text, body) => {
    expect(request(text).body).toEqual(body);
  });
});
