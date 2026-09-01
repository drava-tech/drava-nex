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
 */
export const LIGHT_GROUP: { uuid: string; deviceId: string }[] = [
  { uuid: "62c1a059-3fdb-4d25-8743-f7cb51c83b49", deviceId: "casambi-light-17" },
  { uuid: "717d2c30-e609-4ace-9afb-b4414b7be1a3", deviceId: "casambi-light-19" },
];

/**
 * The fixed look both drivers get on every switch-on. Not user-editable by
 * design — the card has no colour or brightness control, so sending the same
 * values to both targets is what keeps the two fixtures from drifting apart.
 * Note CasambiDeviceDriver hardcodes `white: 0`, so this warm white is mixed
 * from RGB only and the DALI driver's white LEDs stay dark.
 */
export const GROUP_ON_BRIGHTNESS = 100;
export const GROUP_ON_COLOR = "#FFF3E0";

/** True for either driver in the group. */
export function isGroupDeviceId(deviceId: string): boolean {
  return LIGHT_GROUP.some((d) => d.deviceId === deviceId);
}
