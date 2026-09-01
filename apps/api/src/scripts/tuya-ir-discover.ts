// Prints the Tuya ids the IR driver needs. Run after re-pairing anything in
// Smart Life, then paste the results into .env + seed-ir-devices.ts:
//
//   pnpm --filter @platform/api tuya:discover [hubId]
//
// Hub id defaults to TUYA_IR_HUB_ID; find it on iot.tuya.com under
// Cloud → your project → Devices (the row whose Product is "IR blaster").
//
// NOTE: /v1.3/iot-03/devices returns nothing for devices linked via "Link App
// Account" — sub-devices under the hub is the listing that actually works.
import "../lib/load-env.js";
import { TuyaContext } from "@tuya/tuya-connector-nodejs";

const HUB = process.argv[2] || process.env["TUYA_IR_HUB_ID"] || "";

const tuya = new TuyaContext({
  baseUrl: process.env["TUYA_BASE_URL"] || "https://openapi.tuyain.com",
  accessKey: process.env["TUYA_ACCESS_ID"] || "",
  secretKey: process.env["TUYA_ACCESS_SECRET"] || "",
});

async function get(path: string) {
  const res = await tuya.request({ method: "GET", path });
  if (!res.success) throw new Error(`${path} → ${res.msg} (code ${res.code})`);
  return res.result as any;
}

async function main(): Promise<void> {
  if (!HUB) throw new Error("no hub id — pass one as an argument or set TUYA_IR_HUB_ID");

  const hub = await get(`/v1.0/devices/${HUB}`);
  console.log(`\nHub  ${hub.id}  ${hub.name}  category=${hub.category}  online=${hub.online}`);
  console.log(`     → TUYA_IR_HUB_ID=${hub.id}\n`);

  const subs: any[] = (await get(`/v1.0/devices/${HUB}/sub-devices`)) ?? [];
  if (!subs.length) {
    console.log("No remotes paired under this hub yet — add them in the Smart Life app.");
    return;
  }
  console.log(`${subs.length} remote(s) — paste each id as a deviceId in seed-ir-devices.ts:\n`);
  for (const s of subs) {
    console.log(`  ${s.id}  category=${String(s.category).padEnd(12)} online=${String(s.online).padEnd(5)} ${s.name}`);
    // Non-AC remotes need category_id + remote_index in config; AC uses the scenes endpoint.
    if (s.category !== "infrared_ac") {
      const keys = await get(`/v2.0/infrareds/${HUB}/remotes/${s.id}/keys`).catch(() => null);
      if (keys?.key_list) {
        console.log(`      category_id=${keys.category_id ?? "?"} remote_index=${keys.remote_index ?? "?"}`);
        console.log(`      keys: ${keys.key_list.map((k: any) => k.key_name ?? k.key).join(", ")}`);
      }
    }
  }
}

main().catch((err) => {
  console.error("[tuya:discover] failed:", err.message ?? err);
  process.exit(1);
});
