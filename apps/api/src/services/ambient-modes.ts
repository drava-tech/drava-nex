import { listDevices, getAmbientMode, listAmbientModes, type Device, type AmbientMode } from "@platform/db";
import type { LightState } from "@platform/types";
import { applyLightState, getCasambiDriver } from "./devices.js";

/**
 * Whole-room lighting modes ("pre-entry", "entry", "meeting", "presentation").
 * One implementation shared by the CMS (POST /api/ambient-modes/:key/apply) and
 * TRAVIS (voice-actions' ambient_mode action and "Travis hi"), so a mode looks
 * the same no matter who asked for it.
 *
 * How a mode reaches the hardware mirrors the CMS's own Warm/Colour buttons
 * (apps/cms/src/app/(dashboard)/environment/_components/environment-view.tsx):
 * a fixture group's White/Colour balance can only be moved by recalling a
 * Casambi mesh scene, so that happens first, and the colour/brightness follow.
 */

/** "#FFF3E0" — the CMS Warm White swatch. A mode with this colour uses the fixtures' white LEDs. */
export const WARM_WHITE_HEX = "#FFF3E0";

/**
 * Casambi mesh scenes that flip each fixture group between its white and its
 * colour LEDs. Kept in step with SCENE_MODE_GROUPS in
 * apps/cms/src/lib/casambi-lights.ts, which documents how these were verified
 * (each pair moves only its own fixtures — scenes are network-wide, so a group
 * without its own pair must never borrow another's).
 */
export const SCENE_MODE_GROUPS: Record<string, { warm: number[]; colour: number[] }> = {
  "Stretch Fabric": { warm: [1], colour: [2] },
  "Strip Light": { warm: [3], colour: [4] },
};

/**
 * Time to let a scene recall settle before the brightness/colour command that
 * follows it; sent immediately, the scene's own fade can overwrite it. Not
 * measured on the hardware — tune it if a mode ever lands at the wrong level.
 */
export const SCENE_SETTLE_MS = 800;

const STRIP_GROUP = "Strip Light";

/**
 * The white-channel value a colour needs — the same rule the Casambi driver
 * applies when none is given (casambi-driver.ts toFixtureChannels): near-neutral
 * colours go to the W channel alone, saturated ones to RGB alone. It is passed
 * explicitly because applyLightState merges onto the fixture's LAST state, so
 * a stale white=255 from a warm mode would otherwise ride along into a colour
 * mode and wash it out.
 */
export function whiteChannelFor(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const max = Math.max(r, g, b);
  const sat = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
  return sat < 0.25 ? max : 0;
}

/**
 * Which set of LEDs a colour needs. Anything the white channel carries (warm
 * white, neutral white) uses the fixtures' white LEDs — the "warm" scene; every
 * other colour needs their colour LEDs — the "colour" scene. A fixture in the
 * wrong mode ignores the command, which is why the scene is recalled first.
 */
export function sceneKindFor(color: string): "warm" | "colour" {
  return whiteChannelFor(color) > 0 ? "warm" : "colour";
}

/** "Stretch Fabric 1" -> "Stretch Fabric": same grouping the CMS lighting panel uses. */
export function fixtureGroupName(name: string): string {
  return name.replace(/\s*\d+\s*$/, "").trim() || name;
}

export interface AmbientPlanStep {
  group: string;
  members: Device[];
  /** Casambi scenes to recall first ([] = none). */
  scenes: number[];
  state: LightState;
}

/** What each fixture group gets for this mode. Pure, so it can be tested without hardware. */
export function planAmbientMode(
  mode: Pick<AmbientMode, "color" | "brightness" | "stripOn">,
  lights: Device[]
): AmbientPlanStep[] {
  const groups = new Map<string, Device[]>();
  for (const d of lights) {
    const g = fixtureGroupName(d.name);
    groups.set(g, [...(groups.get(g) ?? []), d]);
  }

  const kind = sceneKindFor(mode.color);
  const brightness = Math.max(0, Math.min(100, Math.round(mode.brightness)));

  return [...groups.entries()].map(([group, members]) => {
    // The strip light sits the mode out entirely when it's switched off for it.
    if (group === STRIP_GROUP && !mode.stripOn) {
      return { group, members, scenes: [], state: { on: false } };
    }
    const scenes = SCENE_MODE_GROUPS[group]?.[kind] ?? [];
    return {
      group,
      members,
      scenes,
      state: { on: true, brightness, color: mode.color, white: whiteChannelFor(mode.color) },
    };
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface AmbientApplyResult {
  /** Lights that took the mode (including the strip going off). */
  applied: number;
  /** Lights that didn't respond. */
  failed: number;
}

/**
 * Put every light into the mode. Best-effort like the other whole-room actions:
 * one unresponsive fixture must not stop the rest, or hide that they worked.
 * `allowedDeviceIds` is the voice agent's scope; the CMS passes nothing.
 */
export async function applyAmbientMode(
  mode: AmbientMode,
  opts: { allowedDeviceIds?: Set<string> | null; settleMs?: number } = {}
): Promise<AmbientApplyResult> {
  const devices = await listDevices();
  const lights = devices.filter(
    (d) => d.type === "light" && (!opts.allowedDeviceIds || opts.allowedDeviceIds.has(d.id))
  );
  const driver = getCasambiDriver();
  const settleMs = opts.settleMs ?? SCENE_SETTLE_MS;

  const perGroup = await Promise.all(
    planAmbientMode(mode, lights).map(async (step): Promise<AmbientApplyResult> => {
      if (step.scenes.length > 0 && driver) {
        try {
          await Promise.all(step.scenes.map((n) => driver.triggerMeshScene(n)));
        } catch (err) {
          console.error(`[ambient] scene recall failed for ${step.group}:`, err);
          return { applied: 0, failed: step.members.length };
        }
        if (settleMs > 0) await sleep(settleMs);
      }
      const results = await Promise.allSettled(step.members.map((d) => applyLightState(d, step.state)));
      const applied = results.filter((r) => r.status === "fulfilled").length;
      return { applied, failed: results.length - applied };
    })
  );

  return perGroup.reduce(
    (sum, r) => ({ applied: sum.applied + r.applied, failed: sum.failed + r.failed }),
    { applied: 0, failed: 0 }
  );
}

/**
 * Before setting a colour on some lights, flip their fixture groups to the LEDs
 * that colour needs (see sceneKindFor). A scene recall is network-wide for its
 * group — it also switches on any sibling not being targeted (asking for
 * "tusker L1" blue would light "tusker L2") — so those siblings are returned for
 * the caller to put back once the colour is set.
 */
export async function prepareGroupsForColor(
  targets: Device[],
  color: string,
  opts: { settleMs?: number } = {}
): Promise<Device[]> {
  const driver = getCasambiDriver();
  const groups = new Set(targets.map((d) => fixtureGroupName(d.name)).filter((g) => SCENE_MODE_GROUPS[g]));
  if (!driver || groups.size === 0) return [];

  const kind = sceneKindFor(color);
  await Promise.all([...groups].flatMap((g) => SCENE_MODE_GROUPS[g]![kind]).map((n) => driver.triggerMeshScene(n)));
  const settleMs = opts.settleMs ?? SCENE_SETTLE_MS;
  if (settleMs > 0) await sleep(settleMs);

  const targeted = new Set(targets.map((d) => d.id));
  return (await listDevices()).filter(
    (d) => d.type === "light" && groups.has(fixtureGroupName(d.name)) && !targeted.has(d.id)
  );
}

/** Letters and digits only, lowercased, without a trailing "mode": "Pre-entry mode" -> "preentry". */
function simplify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/mode$/, "");
}

/**
 * Find a mode from what was said ("entry mode", "pre entry", "presentation").
 * Whole-name matches only — "entry" must never match "pre-entry".
 */
export async function resolveAmbientMode(spoken: string): Promise<AmbientMode | null> {
  const q = simplify(spoken);
  if (!q) return null;
  const modes = await listAmbientModes();
  return modes.find((m) => simplify(m.key) === q || simplify(m.label) === q) ?? null;
}

export { getAmbientMode, listAmbientModes };
