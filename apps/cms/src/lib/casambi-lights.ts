/**
 * The two Casambi drivers the Environment lighting card switches as one group.
 * `uuid` is the device row id (used for POST /api/devices/lights/:uuid/state);
 * `deviceId` is the stable external id (what LIGHT_STATE_UPDATE WS broadcasts
 * carry — see apps/api/src/routes/devices.ts and services/casambi-ingest.ts).
 * Both rows come from `pnpm --filter @platform/api seed:casambi`.
 *
 * Confirmed against the real Casambi network by blinking each unit: target 17
 * and target 19 are the only online dimmable drivers, and both respond. The
 * older casambi-light-2/3/4 rows point at units 12/13/4, which have since gone
 * offline and are deliberately left out.
 *
 * Both units report state, but only sporadically — the gateway polls them on a
 * slow rotation, so either one can stay silent for 30s+ after a command while
 * the other answers immediately. Neither is authoritative on its own; since
 * they are always commanded together, whichever one reports tells us the
 * group's state.
 *
 * Calibrated 2026-09-02 by driving known RGBW values and reading back:
 *   sent (255,0,0)     -> #FF000E  red      correct
 *   sent (0,255,0)     -> #000AFF  blue     green/blue appear swapped
 *   sent (0,0,255)     -> #59FF55  green    green/blue appear swapped
 *   sent (255,243,224) -> #FF0030  red      saturation forced to 254
 * Unit 19 lags unit 17 by ~35s but both settle to identical values, so the
 * "two different colours" symptom is mostly reporting lag, not permanent
 * drift. Whether the green/blue swap is in the command or only the readback
 * is unresolved — see SWAP_GREEN_BLUE in casambi-driver.ts.
 */
export const LIGHT_GROUP: { uuid: string; deviceId: string }[] = [
  { uuid: "62c1a059-3fdb-4d25-8743-f7cb51c83b49", deviceId: "casambi-light-17" },
  { uuid: "717d2c30-e609-4ace-9afb-b4414b7be1a3", deviceId: "casambi-light-19" },
];

/**
 * What the group is set to when switched on with no colour chosen yet.
 *
 * Measured behaviour of these fixtures (see CasambiDeviceDriver.rgbToRgbw):
 * the RGB path always renders a FULLY SATURATED hue — a warm white sent as
 * RGB came back at saturation 254, i.e. red. Whites only work through the
 * dedicated W channel. The driver splits every colour into W + chromatic
 * remainder, so the presets below are chosen to sit cleanly on one side of
 * that split: the whites are almost pure W, the colours almost pure RGB.
 */
export const GROUP_ON_BRIGHTNESS = 100;
export const DEFAULT_GROUP_COLOR = "#FFF3E0";

/**
 * Everyday colours, offered as swatches on the card so the common cases are
 * one tap and don't depend on hitting a precise point in the picker.
 */
export const LIGHT_PRESETS: { name: string; hex: string }[] = [
  { name: "Warm White", hex: "#FFF3E0" },
  { name: "Neutral White", hex: "#FFFFFF" },
  { name: "Amber", hex: "#FF9000" },
  { name: "Red", hex: "#FF0000" },
  { name: "Green", hex: "#00FF00" },
  { name: "Cyan", hex: "#00FFFF" },
  { name: "Blue", hex: "#0000FF" },
  { name: "Magenta", hex: "#FF00FF" },
];

/** True for either driver in the group. */
export function isGroupDeviceId(deviceId: string): boolean {
  return LIGHT_GROUP.some((d) => d.deviceId === deviceId);
}
