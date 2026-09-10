/**
 * Constants for the Casambi lighting UI.
 *
 * The fixture roster deliberately does NOT live here any more — it is read at
 * runtime by listLights() in @/actions/light-actions. A hardcoded list of row
 * uuids broke twice as the mesh changed underneath it (targets 12/13 went
 * offline, then 17 did), each time needing a code change and a redeploy to
 * notice. Only calibration facts and colour constants belong in this file.
 *
 * Calibrated 2026-09-02 by driving known RGBW values and reading back:
 *   sent (255,0,0)     -> #FF000E  red      correct
 *   sent (0,255,0)     -> #000AFF  blue     green/blue appear swapped
 *   sent (0,0,255)     -> #59FF55  green    green/blue appear swapped
 *   sent (255,243,224) -> #FF0030  red      saturation forced to 254
 *
 * Two consequences drive the driver's colour handling (see casambi-driver.ts):
 * the RGB path can only render fully saturated hues, so whites must come from
 * the dedicated W channel; and whether the green/blue swap sits in the command
 * or only in the readback is still unresolved (SWAP_GREEN_BLUE).
 *
 * Fixtures lag each other by ~35s in reporting but settle to identical values,
 * so apparent "two different colours" is usually reporting lag, not drift.
 */

/** What a fixture is set to when switched on with no colour chosen yet. */
export const GROUP_ON_BRIGHTNESS = 100;
export const DEFAULT_GROUP_COLOR = "#FFF3E0";

/**
 * Everyday colours, offered as swatches so the common cases are one tap.
 *
 * Chosen to sit cleanly on one side of the driver's channel split (see
 * toFixtureChannels): the whites are near-neutral so they go out as pure W,
 * the colours fully saturated so they go out as pure RGB. Anything in
 * between renders as a vivid hue on this hardware, not as a tint.
 */
export const LIGHT_PRESETS: { name: string; hex: string }[] = [
  { name: "Warm White", hex: "#FFF3E0" },
  { name: "Neutral White", hex: "#FFFFFF" },
  { name: "Red", hex: "#FF0000" },
  { name: "Green", hex: "#00FF00" },
  { name: "Cyan", hex: "#00FFFF" },
  { name: "Blue", hex: "#0000FF" },
  { name: "Magenta", hex: "#FF00FF" },
];


/**
 * Fixtures that should be driven as one, derived from their names.
 *
 * "Stretch Fabric 0" and "Stretch Fabric 1" collapse to a single "Stretch
 * Fabric" row that sends the same command to both; "Strip Light" stays on its
 * own. Grouping by name rather than by device id is deliberate — ids change
 * when a fixture is re-paired (target 17 became 20/21 exactly that way), and a
 * hardcoded id list has already broken this UI twice. Renaming in the seed is
 * all it takes to regroup.
 */
export function groupLights<T extends { name: string }>(lights: T[]): { name: string; members: T[] }[] {
  const order: string[] = [];
  const bucket = new Map<string, T[]>();
  for (const l of lights) {
    // "Stretch Fabric 1" -> "Stretch Fabric"; names without a trailing number
    // are their own group and stay individual.
    const key = l.name.replace(/\s*\d+\s*$/, "").trim() || l.name;
    if (!bucket.has(key)) { bucket.set(key, []); order.push(key); }
    bucket.get(key)!.push(l);
  }
  return order.map((name) => ({ name, members: bucket.get(name)! }));
}

/**
 * How each fixture group switches between warm and colour.
 *
 * A fixture's White/Colour balance is NOT settable by any direct MQTT command —
 * every topic the gateway subscribes to was probed. A Casambi scene stores that
 * balance as part of itself, so recalling one is the only way to move a fixture
 * between warm and colour.
 *
 * A scene is NETWORK-WIDE: it applies to its own members regardless of which
 * fixture the UI asked about. Isolation therefore comes from DISJOINT SCENE
 * MEMBERSHIP, not from avoiding scenes — an earlier version routed the Strip
 * Light through the fabrics' scene and its Warm button moved the fabric panels.
 *
 * Each group now has its own pair, verified 2026-09-04 to move only its own
 * fixtures:
 *     scene 1 -> fabric warm    (unit 28: 255 -> 0),  strip unaffected
 *     scene 2 -> fabric colour  (unit 28: 0 -> 255),  strip unaffected
 *     scene 3 -> strip warm     (unit 23: 255 -> 0),  fabrics unaffected
 *     scene 4 -> strip colour   (unit 23: 0 -> 255),  fabrics unaffected
 *
 * Adding a group here without its OWN scenes would reintroduce that cross-talk,
 * so confirm a new pair moves only its own fixtures before wiring it up.
 *
 * Keyed by GROUP NAME rather than device id: ids have been renumbered by
 * re-pairing four times, names have not. Scene membership itself is edited in
 * the Casambi app, so if a fixture stops following Warm, check it is a member
 * there before changing code.
 */
export const SCENE_MODE_GROUPS: Record<string, { warm: number[]; colour: number[] }> = {
  "Stretch Fabric": { warm: [1], colour: [2] },
  "Strip Light": { warm: [3], colour: [4] },
};

/** What "warm" means for a fixture with no separate white source. */
export const WARM_WHITE_HEX = "#FFF3E0";

/** True when this group's warm/colour mode is switched by recalling a scene. */
export function usesSceneMode(groupName: string): boolean {
  return groupName in SCENE_MODE_GROUPS;
}
