import type { MQTTDeviceManager } from "@platform/iot";
import {
  listDevices,
  setDeviceState,
  listScreens,
  listExperiences,
  listMediaAssets,
  setScreenExperience,
  setScreenMedia,
  setScreenBlanked,
  type Device,
} from "@platform/db";
import { applyLightState, applyIrCommandToState } from "../routes/devices.js";
import { pushScreenContent } from "../routes/screens.js";
import { getIrDriver } from "./devices.js";
import { setDoorLock } from "./door-lock.js";
import { broadcastToCms, clearTakeoverFlag, sendCommandToScreen, setScreenBlankState } from "../ws/gateway.js";

/**
 * Actions behind /api/voice-control (routes/voice-control.ts), used by
 * services/voice-control — the rule-based TRAVIS voice front end.
 *
 * The voice client sends names exactly as spoken ("stretch fabric", "screen
 * 2", "welcome video"); resolution to real rows happens here, against the
 * same tables the CMS uses, and every action goes through the same functions
 * as the CMS's own buttons (applyLightState, the IR driver, the Home
 * Assistant lock, pushScreenContent, the screen remote-command channel).
 * Errors name the real options so Travis can say them — nothing is guessed.
 */

export class VoiceControlError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "AMBIGUOUS" | "UNSUPPORTED" | "INVALID" | "DRIVER_ERROR",
    readonly status: 400 | 404 | 409 | 502 = 400
  ) {
    super(message);
  }
}

export interface VoiceControlResult {
  message: string;
  /** Real names acted on, for logs. */
  targets?: string[];
}

// ─── Name resolution ──────────────────────────────────────────────────────

/** "Screen-2" / "screen 2" / "TV86inch" -> comparable word sequences. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Items whose name matches the spoken query: every exact (normalized) match
 * if there is one, otherwise every item whose name contains all the query's
 * words. May return several — callers decide whether a group is acceptable
 * (lights: yes, "stretch fabric" = both fixtures) or ambiguous (screens).
 */
export function matchByName<T>(query: string, items: T[], names: (item: T) => string[]): T[] {
  const q = normalizeName(query);
  if (!q) return [];
  const exact = items.filter((i) => names(i).some((n) => normalizeName(n) === q));
  if (exact.length > 0) return exact;
  const words = q.split(" ");
  return items.filter((i) =>
    names(i).some((n) => {
      const nameWords = normalizeName(n).split(" ");
      return words.every((w) => nameWords.includes(w));
    })
  );
}

function optionsHint(names: string[], noun: string): string {
  if (names.length === 0) return ` There are no ${noun}.`;
  const shown = names.slice(0, 10);
  return ` The ${noun} are: ${shown.join(", ")}${names.length > shown.length ? ", and more" : ""}.`;
}

function pickOne<T>(query: string, items: T[], names: (item: T) => string[], label: (item: T) => string, noun: string): T {
  const matches = matchByName(query, items, names);
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new VoiceControlError(`I couldn't find ${noun.replace(/s$/, "")} called "${query}".` + optionsHint(items.map(label), noun), "NOT_FOUND", 404);
  }
  throw new VoiceControlError(`"${query}" could be ${matches.map(label).join(" or ")}. Which one?`, "AMBIGUOUS", 409);
}

// ─── Lights ───────────────────────────────────────────────────────────────

/**
 * Spoken colour -> hex for the lights (the Casambi driver only understands
 * hex; it derives the white channel itself for low-saturation colours).
 */
export const LIGHT_COLORS: Record<string, string> = {
  red: "#FF0000",
  green: "#00FF00",
  blue: "#0000FF",
  white: "#FFFFFF",
  "warm white": "#FFB46B",
  "cool white": "#DCE8FF",
  yellow: "#FFD500",
  orange: "#FF7A00",
  purple: "#8A2BE2",
  pink: "#FF4FA3",
  cyan: "#00E5FF",
};

/** Words that just mean "light" in a spoken target ("the stretch fabric lights"). */
const LIGHT_WORDS = new Set(["light", "lights", "lamp", "lamps", "all", "the"]);

export interface LightsInput {
  action: "on" | "off" | "set";
  target?: string;
  brightness?: number;
  color?: string;
}

export async function controlLights(input: LightsInput): Promise<VoiceControlResult> {
  const lights = (await listDevices()).filter((d) => d.type === "light");
  if (lights.length === 0) throw new VoiceControlError("There are no lights set up in the CMS.", "UNSUPPORTED");

  const query = (input.target ?? "")
    .split(/\s+/)
    .filter((w) => w && !LIGHT_WORDS.has(w.toLowerCase()))
    .join(" ");
  const targets = query ? matchByName(query, lights, (d) => [d.name, d.deviceId]) : lights;
  if (targets.length === 0) {
    throw new VoiceControlError(
      `I couldn't find lights called "${input.target}".` + optionsHint(lights.map((d) => d.name), "lights"),
      "NOT_FOUND",
      404
    );
  }

  let color: string | undefined;
  if (input.color) {
    color = LIGHT_COLORS[input.color.toLowerCase()];
    if (!color) {
      throw new VoiceControlError(
        `I can't do the colour "${input.color}".` + optionsHint(Object.keys(LIGHT_COLORS), "colours"),
        "INVALID"
      );
    }
  }

  const on = input.action !== "off";
  const results = await Promise.allSettled(
    targets.map((d) => {
      // "Turn on" restores the last brightness; if that was 0 it would stay
      // dark, so fall back to full.
      const prior = (d.state as { brightness?: number } | null)?.brightness;
      const brightness =
        input.brightness !== undefined ? input.brightness : on && input.action === "on" && !(prior && prior > 0) ? 100 : undefined;
      return applyLightState(d, {
        on,
        ...(brightness !== undefined ? { brightness } : {}),
        ...(color ? { color } : {}),
      });
    })
  );
  const failed = results.filter((r) => r.status === "rejected").length;
  const done = targets.length - failed;
  if (done === 0) throw new VoiceControlError("The lights didn't respond.", "DRIVER_ERROR", 502);

  const what = query ? targets.map((d) => d.name).join(" and ") : `${done} light${done === 1 ? "" : "s"}`;
  let message: string;
  if (input.action === "off") message = `Turned off ${what}.`;
  else if (input.action === "on" && input.brightness === undefined && !color) message = `Turned on ${what}.`;
  else {
    const parts = [input.brightness !== undefined ? `${input.brightness} percent` : "", input.color ?? ""].filter(Boolean);
    message = `Set ${what} to ${parts.join(" ")}.`;
  }
  if (failed > 0) message += ` ${failed} light${failed === 1 ? "" : "s"} didn't respond.`;
  return { message, targets: targets.map((d) => d.name) };
}

// ─── IR: AC and TV volume ─────────────────────────────────────────────────

/** Same sequence as POST /api/devices/ir/:id/command: send, fold state, broadcast. */
async function sendIr(device: Device, command: string, params?: Record<string, unknown>): Promise<void> {
  const driver = getIrDriver();
  if (!driver) throw new VoiceControlError("IR control isn't configured.", "UNSUPPORTED");
  try {
    await driver.sendCommand(device, { command, ...(params ? { params } : {}) });
  } catch (err) {
    console.error(`[voice-control] IR ${command} to ${device.name} failed:`, err);
    throw new VoiceControlError(`${device.name} didn't respond.`, "DRIVER_ERROR", 502);
  }
  const updated = await setDeviceState(device.id, applyIrCommandToState(device.state ?? {}, command, params));
  broadcastToCms({ type: "IR_STATE_UPDATE", deviceId: device.deviceId, state: updated.state });
}

function irDevices(devices: Device[], kind: string): Device[] {
  return devices.filter((d) => (d.config as { irDevice?: string } | null)?.irDevice === kind);
}

export const AC_MODES = ["cool", "heat", "auto", "fan", "dry"] as const;

export interface AcInput {
  action: "power_on" | "power_off" | "set_temp" | "set_mode";
  temp?: number;
  mode?: (typeof AC_MODES)[number];
  target?: string;
}

export async function controlAc(input: AcInput): Promise<VoiceControlResult> {
  const acs = irDevices(await listDevices(), "ac");
  if (acs.length === 0) throw new VoiceControlError("There's no AC set up in the CMS.", "UNSUPPORTED");
  // One AC: "the AC" / "air conditioner" can only mean it. Several: resolve the name.
  const ac =
    acs.length === 1
      ? acs[0]!
      : input.target
        ? pickOne(input.target, acs, (d) => [d.name], (d) => d.name, "ACs")
        : (() => {
            throw new VoiceControlError("Which AC?" + optionsHint(acs.map((d) => d.name), "ACs"), "AMBIGUOUS", 409);
          })();

  switch (input.action) {
    case "power_on":
      await sendIr(ac, "power_on");
      return { message: `${ac.name} is on.`, targets: [ac.name] };
    case "power_off":
      await sendIr(ac, "power_off");
      return { message: `${ac.name} is off.`, targets: [ac.name] };
    case "set_temp":
      if (input.temp === undefined) throw new VoiceControlError("What temperature?", "INVALID");
      await sendIr(ac, "set_temp", { temp: input.temp });
      return { message: `${ac.name} set to ${input.temp} degrees.`, targets: [ac.name] };
    case "set_mode":
      if (!input.mode) throw new VoiceControlError("Which mode?" + optionsHint([...AC_MODES], "modes"), "INVALID");
      await sendIr(ac, "set_mode", { mode: input.mode });
      return { message: `${ac.name} set to ${input.mode} mode.`, targets: [ac.name] };
  }
}

export interface VolumeInput {
  action: "up" | "down" | "mute";
  times?: number;
}

/**
 * Room volume. The sound comes out of the soundbar, but it is driven through
 * the TV's IR remote (Volume Up / Volume Down / mute — real Tuya key names),
 * which forwards to the soundbar. The remote is one-way, so there is no level
 * to read or set, and the reply never states one.
 */
export async function controlVolume(input: VolumeInput): Promise<VoiceControlResult> {
  const tv = irDevices(await listDevices(), "tv")[0];
  if (!tv) throw new VoiceControlError("I can't reach the TV's remote to change the volume.", "UNSUPPORTED");

  if (input.action === "mute") {
    // A single toggle key on this remote — no separate unmute.
    await sendIr(tv, "mute");
    return { message: "Toggled mute.", targets: [tv.name] };
  }
  const key = input.action === "up" ? "Volume Up" : "Volume Down";
  const times = Math.min(10, Math.max(1, Math.round(input.times ?? 1)));
  let pressed = 0;
  try {
    for (; pressed < times; pressed++) await sendIr(tv, key);
  } catch (err) {
    if (pressed === 0) throw err;
    return { message: `Only ${pressed} of ${times} volume steps went through.`, targets: [tv.name] };
  }
  return {
    message: `Volume ${input.action}${times > 1 ? `, ${times} steps` : ""}.`,
    targets: [tv.name],
  };
}

// ─── Door ─────────────────────────────────────────────────────────────────

export async function controlDoor(mqtt: MQTTDeviceManager, action: "lock" | "unlock"): Promise<VoiceControlResult> {
  try {
    await setDoorLock(mqtt, action === "lock" ? "locked" : "unlocked", "voice-control");
  } catch (err) {
    console.error("[voice-control] Home Assistant call failed:", err);
    throw new VoiceControlError("I couldn't reach the door lock.", "DRIVER_ERROR", 502);
  }
  return { message: action === "lock" ? "Door locked." : "Door unlocked." };
}

// ─── Screens and content ──────────────────────────────────────────────────

async function resolveScreen(spoken: string) {
  const screens = await listScreens();
  return pickOne(spoken, screens, (s) => [s.screenName, s.screenId], (s) => s.screenName || s.screenId, "screens");
}

/** Same remote-command payload the CMS playback controls send (playback-protocol.ts). */
const MEDIA_SET_PAUSED = "MEDIA_SET_PAUSED";

export interface ScreenInput {
  action: "play" | "pause" | "stop";
  screen: string;
}

export async function controlScreen(input: ScreenInput): Promise<VoiceControlResult> {
  const screen = await resolveScreen(input.screen);
  const name = screen.screenName || screen.screenId;

  if (input.action === "stop") {
    // The CMS "Stop" button: full-black overlay, persisted so a reconnect stays black.
    await setScreenBlanked(screen.screenId, true);
    setScreenBlankState(screen.screenId, true);
    return { message: `${name} stopped.`, targets: [name] };
  }

  if (input.action === "play" && screen.blanked) {
    await setScreenBlanked(screen.screenId, false);
    setScreenBlankState(screen.screenId, false);
  }
  const delivered = sendCommandToScreen(screen.screenId, MEDIA_SET_PAUSED, { paused: input.action === "pause" });
  if (delivered === 0) {
    throw new VoiceControlError(`${name} isn't connected right now.`, "UNSUPPORTED", 409);
  }
  return { message: `${name} ${input.action === "pause" ? "paused" : "playing"}.`, targets: [name] };
}

export interface ContentInput {
  /** "any" = an experience if one matches, otherwise a media item. */
  kind: "experience" | "media" | "any";
  content: string;
  screen: string;
}

export async function pushContent(input: ContentInput): Promise<VoiceControlResult> {
  const screen = await resolveScreen(input.screen);
  const screenName = screen.screenName || screen.screenId;

  const experiences = input.kind === "media" ? [] : await listExperiences();
  const media = input.kind === "experience" ? [] : (await listMediaAssets({ pageSize: 100 })).items;
  const expMatches = matchByName(input.content, experiences, (e) => [e.title]);
  const mediaMatches = matchByName(input.content, media, (m) => [m.name]);

  let chosen: { kind: "experience"; id: string; name: string } | { kind: "media"; id: string; name: string };
  if (expMatches.length === 1) chosen = { kind: "experience", id: expMatches[0]!.id, name: expMatches[0]!.title };
  else if (expMatches.length === 0 && mediaMatches.length === 1)
    chosen = { kind: "media", id: mediaMatches[0]!.id, name: mediaMatches[0]!.name };
  else {
    const candidates = [...expMatches.map((e) => e.title), ...mediaMatches.map((m) => m.name)];
    if (candidates.length > 1) {
      throw new VoiceControlError(`"${input.content}" could be ${candidates.slice(0, 5).join(" or ")}. Which one?`, "AMBIGUOUS", 409);
    }
    const all = [...experiences.map((e) => e.title), ...media.map((m) => m.name)];
    const noun = input.kind === "experience" ? "experiences" : input.kind === "media" ? "media items" : "experiences and media";
    throw new VoiceControlError(`I couldn't find "${input.content}".` + optionsHint(all, noun), "NOT_FOUND", 404);
  }

  // Same sequence as POST /api/screens/:id/experience and /media.
  if (chosen.kind === "experience") await setScreenExperience(screen.screenId, chosen.id);
  else await setScreenMedia(screen.screenId, chosen.id);
  clearTakeoverFlag(screen.screenId);
  setScreenBlankState(screen.screenId, false);
  await pushScreenContent(screen.screenId);
  return { message: `Playing ${chosen.name} on ${screenName}.`, targets: [screenName, chosen.name] };
}

// ─── Names (debugging / setup) ────────────────────────────────────────────

export async function listVoiceControlNames() {
  const devices = await listDevices();
  return {
    lights: devices.filter((d) => d.type === "light").map((d) => d.name),
    ac: irDevices(devices, "ac").map((d) => d.name),
    volume: irDevices(devices, "tv").map((d) => d.name),
    screens: (await listScreens()).map((s) => s.screenName || s.screenId),
    experiences: (await listExperiences()).map((e) => e.title),
    media: (await listMediaAssets({ pageSize: 100 })).items.map((m) => m.name),
    colours: Object.keys(LIGHT_COLORS),
    acModes: [...AC_MODES],
  };
}
