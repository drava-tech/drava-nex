// One-off: register the IR devices the CrabController bridge fronts, so the CMS
// has device rows to command. Idempotent (upsert on deviceId). Run with:
//
//   pnpm --filter @platform/api seed:ir
//
// Then paste each printed uuid into apps/cms/src/lib/ir-devices.ts.
import "../lib/load-env.js";
import { upsertDevice } from "@platform/db";

// `config.driver: "ir"` selects the IR driver; `config.irDevice` is the
// bridge-side remote name (the `device` field CrabController dispatches on).
const IR_DEVICES = [
  { deviceId: "d73ea59a396b84072boahv", type: "ir", name: "Experience AC", config: { driver: "ir", irDevice: "ac" } },
  { deviceId: "d7d74af8f0b7a3a5c24ca6", type: "ir", name: "TV", config: { driver: "ir", irDevice: "tv", categoryId: 2, remoteIndex: 692 } },
  { deviceId: "d746e7d41e962b00dd0jhl", type: "ir", name: "Soundbar", config: { driver: "ir", irDevice: "soundbar", categoryId: 7, remoteIndex: 417259975 } },
];

async function main(): Promise<void> {
  for (const d of IR_DEVICES) {
    const row = await upsertDevice(d);
    console.log(`✓ ${row.name.padEnd(20)} deviceId=${row.deviceId}  uuid=${row.id}`);
  }
  console.log("\nPaste each uuid into apps/cms/src/lib/ir-devices.ts (IR_AC.uuid / IR_REMOTES[].uuid).");
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-ir-devices] failed:", err);
  process.exit(1);
});
