/**
 * Maps the CMS IR surfaces to registered IR devices behind the CrabController
 * bridge. `uuid` is the device row id (used for POST /api/devices/ir/:uuid/
 * command); `deviceId` is the stable external id carried by IR_STATE_UPDATE WS
 * broadcasts; `irDevice` is the bridge-side remote name (config.irDevice —
 * "ac", "tv", …), matching the `device` field CrabController dispatches on.
 *
 * ⚠️ The uuids below are placeholders. Register each IR device once via
 * `pnpm --filter @platform/api seed:ir` and paste the returned row ids here —
 * same flow as apps/cms/src/lib/casambi-lights.ts.
 */

export interface IrDeviceConfig {
  uuid: string;
  deviceId: string;
  irDevice: string;
}

/** The air-conditioner wired to the environment Climate panel. */
export const IR_AC: IrDeviceConfig = {
  uuid: "b7481310-8761-4cd3-be02-d1c67e305d9f",
  deviceId: "d7b20d1b6760571b8b0cnw", // "Experience Centre AC" under hub Smart IR
  irDevice: "ac",
};

/**
 * True once a real device row id has been pasted above. Until then the Climate
 * panel stays in mock mode (no hydration fetch, commands are no-ops) so the page
 * still renders cleanly before the IR device is registered.
 */
export const IR_AC_CONFIGURED = !IR_AC.uuid.startsWith("REPLACE_");

/**
 * Non-AC codebook remotes rendered in the Remotes overlay. `keys` are the exact
 * key names configured under `remotes:` in CrabController's config.yaml (and
 * harvested via scripts/harvest_codes.py) — each becomes the `command` sent.
 */
export interface IrRemoteConfig extends IrDeviceConfig {
  label: string;
  keys: string[];
}

export const IR_REMOTES: IrRemoteConfig[] = [
  {
    label: "TV",
    uuid: "06763297-4d5a-47e9-9b33-66c2bddf17ee",
    deviceId: "d7d74af8f0b7a3a5c24ca6",
    irDevice: "tv",
    keys: ["Power", "Volume+", "Volume-", "Channel+", "Channel-", "Up", "Down", "Left", "Right", "OK", "Menu"],
  },
  {
    label: "Soundbar",
    uuid: "17f7abf9-768b-4611-b3cb-d80d33005563",
    deviceId: "d746e7d41e962b00dd0jhl",
    irDevice: "soundbar",
    keys: ["Volume+", "Volume-", "Play", "Pause", "Previous", "Next"],
  },
];

/** Reverse-lookup an IR device by the deviceId carried on WS broadcasts. */
export function irDeviceForDeviceId(deviceId: string): IrDeviceConfig | null {
  if (IR_AC.deviceId === deviceId) return IR_AC;
  return IR_REMOTES.find((r) => r.deviceId === deviceId) ?? null;
}

// ── AC value maps: Climate-panel display labels ⇄ CrabController vocabulary ──
// Bridge modes: cool|heat|auto|fan|dry ; fans: auto|low|mid|high.

export function acModeToBridge(mode: string): string {
  return mode.toLowerCase();
}
export function acModeFromBridge(mode: string): string {
  return mode ? mode.charAt(0).toUpperCase() + mode.slice(1) : mode;
}

const FAN_SPEED_TO_BRIDGE: Record<string, string> = { low: "low", med: "mid", high: "high", auto: "auto" };
const FAN_SPEED_FROM_BRIDGE: Record<string, string> = { low: "Low", mid: "Med", high: "High", auto: "Auto" };

export function acFanToBridge(fanSpeed: string): string {
  return FAN_SPEED_TO_BRIDGE[fanSpeed.toLowerCase()] ?? "auto";
}
export function acFanFromBridge(fan: string): string {
  return FAN_SPEED_FROM_BRIDGE[fan?.toLowerCase()] ?? "Med";
}
