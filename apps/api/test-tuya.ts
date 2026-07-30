import { TuyaContext } from "@tuya/tuya-connector-nodejs";
import "./src/lib/load-env.js";

const HUB_ID = 'd7100900af2728b91bn2qw';
const TV_ID = 'd7d74af8f0b7a3a5c24ca6';

async function main() {
  console.log("Access ID:", process.env.TUYA_ACCESS_ID ? "Set" : "Not Set");
  console.log("Access Secret:", process.env.TUYA_ACCESS_SECRET ? "Set" : "Not Set");

  const tuya = new TuyaContext({
    baseUrl: "https://openapi.tuyain.com",
    accessKey: process.env.TUYA_ACCESS_ID || "",
    secretKey: process.env.TUYA_ACCESS_SECRET || "",
  });

  try {
    const res = await tuya.request({
      method: "POST",
      path: `/v2.0/infrareds/${HUB_ID}/remotes/${TV_ID}/command`,
      body: {
        category_id: 2,
        remote_index: 692,
        key: "Power"
      }
    });
    console.log("Response:", res);
  } catch (err) {
    console.error("Caught error:", err);
  }
}

main();
