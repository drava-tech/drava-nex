// Register the Casambi drivers the Environment lighting card controls.
// Idempotent (upsert on deviceId). Run with:
//
//   pnpm --filter @platform/api seed:casambi
//
// Nothing to paste afterwards — the CMS reads the roster at runtime through
// listLights(), so adding or removing a fixture here is the whole job.
import "../lib/load-env.js";
import { upsertDevice } from "@platform/db";

// `config.driver: "casambi"` selects CasambiDeviceDriver; `config.targetId` is
// the unit id in the mesh (network CASAMBI_NETWORK_ID). `targetType` is left
// off — the driver defaults it to 1, which is what a single unit needs.
//
// Mesh unit ids as of 2026-09-04, after the network was re-paired:
//   23 = Strip Light        (individual)
//   27 = Stretch Fabric 0   } grouped together in the Casambi app,
//   28 = Stretch Fabric 1   } so the UI drives them as one row
//
// These ids have now changed FOUR times (12/13 -> 17/19 -> 20/21 -> 23/27/28)
// as fixtures were re-paired. Older rows are soft-deleted in the database, not
// listed here, because upsert would otherwise recreate them.
//
// IMPORTANT: the gateway's "online" flag cannot be trusted for this. After a
// re-pair, ghost units keep reporting online:1 and silently swallow every
// command. The only reliable liveness test is functional: send a distinctive
// level and see which unit reports it back. Six units claimed online:1 while
// accepting nothing.
const CASAMBI_LIGHTS = [
  { deviceId: "casambi-light-23", type: "light", name: "Strip Light", config: { driver: "casambi", targetId: 23 } },
  { deviceId: "casambi-light-27", type: "light", name: "Stretch Fabric 0", config: { driver: "casambi", targetId: 27 } },
  { deviceId: "casambi-light-28", type: "light", name: "Stretch Fabric 1", config: { driver: "casambi", targetId: 28 } },
];

async function main(): Promise<void> {
  for (const d of CASAMBI_LIGHTS) {
    const row = await upsertDevice(d);
    console.log(`✓ ${row.name.padEnd(20)} deviceId=${row.deviceId}  uuid=${row.id}`);
  }
  console.log("\nNothing to paste — the CMS reads this list at runtime via listLights().");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-casambi-devices] failed:", err);
  process.exit(1);
});
