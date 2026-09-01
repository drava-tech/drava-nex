// One-off: register the two Casambi drivers the Environment lighting card
// switches as one group. Idempotent (upsert on deviceId). Run with:
//
//   pnpm --filter @platform/api seed:casambi
//
// Then paste each printed uuid into apps/cms/src/lib/casambi-lights.ts.
import "../lib/load-env.js";
import { upsertDevice } from "@platform/db";

// `config.driver: "casambi"` selects CasambiDeviceDriver; `config.targetId` is
// the unit id in the mesh (network CASAMBI_NETWORK_ID). `targetType` is left
// off — the driver defaults it to 1, which is what a single unit needs.
//
// Targets 17 and 19 are the only online dimmable drivers in the network; the
// older casambi-light-2/3/4 rows point at units 12/13/4, which have since gone
// offline. Which of these two is physically the DALI RGB/White vs the Stretch
// Fabric is unconfirmed — both are always driven together, so it only affects
// the display name here.
const CASAMBI_LIGHTS = [
  { deviceId: "casambi-light-17", type: "light", name: "DALI RGB/White", config: { driver: "casambi", targetId: 17 } },
  { deviceId: "casambi-light-19", type: "light", name: "Stretch Fabric", config: { driver: "casambi", targetId: 19 } },
];

async function main(): Promise<void> {
  for (const d of CASAMBI_LIGHTS) {
    const row = await upsertDevice(d);
    console.log(`✓ ${row.name.padEnd(20)} deviceId=${row.deviceId}  uuid=${row.id}`);
  }
  console.log("\nPaste each uuid into apps/cms/src/lib/casambi-lights.ts (LIGHT_GROUP[].uuid).");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-casambi-devices] failed:", err);
  process.exit(1);
});
