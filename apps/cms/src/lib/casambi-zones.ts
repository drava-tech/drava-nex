/**
 * Maps the lighting panel's zone names to registered Casambi devices. `uuid`
 * is the device row id (used for POST /api/devices/lights/:uuid/state);
 * `deviceId` is the stable external id (what LIGHT_STATE_UPDATE WS broadcasts
 * carry — see apps/api/src/routes/devices.ts and services/casambi-ingest.ts).
 *
 * Confirmed against the real Casambi network: target 12 = "8 feet Niche Light",
 * target 13 = "Ledge Light" (both online in the mesh). A 3rd registered device,
 * casambi-light-4 (target 4, offline — a spare/unused driver), is intentionally
 * left out of this zone map.
 */
export const ZONE_DEVICES: Record<string, { uuid: string; deviceId: string }> = {
  "Niche Light": { uuid: "c023207e-bbd7-4e79-884b-039b015a0e93", deviceId: "casambi-light-2" },
  "Ledge Light": { uuid: "f94beac1-d846-4e77-8787-d0aad1d181af", deviceId: "casambi-light-3" },
};

export const ZONE_NAMES = Object.keys(ZONE_DEVICES);

export function zoneForDeviceId(deviceId: string): string | null {
  for (const [zone, dev] of Object.entries(ZONE_DEVICES)) {
    if (dev.deviceId === deviceId) return zone;
  }
  return null;
}
