/**
 * Maps the lighting panel's zone names to registered Casambi devices. `uuid`
 * is the device row id (used for POST /api/devices/lights/:uuid/state);
 * `deviceId` is the stable external id (what LIGHT_STATE_UPDATE WS broadcasts
 * carry — see apps/api/src/routes/devices.ts and services/casambi-ingest.ts).
 *
 * The physical fixture behind each Casambi target id was NOT confirmed at
 * registration time (unlabeled installation) — this mapping is a provisional
 * guess. Use the "Identify" button next to each zone in the Environment page
 * to flash the real fixture and confirm, then fix this mapping if it's wrong.
 */
export const ZONE_DEVICES: Record<string, { uuid: string; deviceId: string }> = {
  "Roof Lights": { uuid: "c023207e-bbd7-4e79-884b-039b015a0e93", deviceId: "casambi-light-2" },
  "Wall Lights 1": { uuid: "f94beac1-d846-4e77-8787-d0aad1d181af", deviceId: "casambi-light-3" },
  "Wall Lights 2": { uuid: "5f2521c0-2842-4ed4-95ce-368d6882d4a5", deviceId: "casambi-light-4" },
};

export const ZONE_NAMES = Object.keys(ZONE_DEVICES);

export function zoneForDeviceId(deviceId: string): string | null {
  for (const [zone, dev] of Object.entries(ZONE_DEVICES)) {
    if (dev.deviceId === deviceId) return zone;
  }
  return null;
}
