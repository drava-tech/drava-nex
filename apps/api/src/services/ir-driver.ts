import { TuyaContext } from "@tuya/tuya-connector-nodejs";
import type { Device } from "@platform/db";

const HUB_ID = 'd7100900af2728b91bn2qw';

// Lazy initialize TuyaContext to avoid crash if env vars are missing on startup
let tuya: TuyaContext | null = null;
function getTuya(): TuyaContext {
  if (!tuya) {
    tuya = new TuyaContext({
      baseUrl: "https://openapi.tuyain.com",
      accessKey: process.env.TUYA_ACCESS_ID || "",
      secretKey: process.env.TUYA_ACCESS_SECRET || "",
    });
  }
  return tuya;
}

export interface IrCommandInput {
  command: string;
  params?: Record<string, unknown>;
}

async function callTuya(path: string, body: Record<string, unknown>) {
  const t = getTuya();
  const res = await t.request({ method: 'POST', path, body });
  if (!res.success) {
    throw new Error(`Tuya IR failed: ${res.msg} (code ${res.code})`);
  }
  return res;
}

export class IrDeviceDriver {
  // MQTT manager is no longer used but kept for signature compatibility with apps/api/src/services/devices.ts
  constructor(_mqtt?: unknown) {}

  async sendCommand(device: Device, input: IrCommandInput): Promise<void> {
    const config = device.config as { irDevice?: string; categoryId?: number; remoteIndex?: number } | null;
    const irDevice = config?.irDevice;
    let remoteId = device.deviceId;
    
    // ponytail: Hardcode Experience AC because DB is unreachable to update the seed
    if (irDevice === "ac") {
      remoteId = "d73ea59a396b84072boahv";
    }

    if (!irDevice) {
      console.warn(`[ir] device ${device.deviceId} missing config.irDevice — skipping Tuya call`);
      return;
    }

    try {
      if (irDevice === "ac") {
        const state = (device.state as {
          power?: boolean;
          mode?: string;
          temp?: number;
          fan?: string;
        }) || {};

        let power = state.power ?? true;
        let modeStr = state.mode ?? "cool";
        let temp = state.temp ?? 24;
        let fanStr = state.fan ?? "auto";

        switch (input.command) {
          case "power_on": power = true; break;
          case "power_off": power = false; break;
          case "set_temp": power = true; temp = Number(input.params?.temp ?? temp); break;
          case "set_mode": power = true; modeStr = String(input.params?.mode ?? modeStr); break;
          case "set_fan": power = true; fanStr = String(input.params?.fan ?? fanStr); break;
        }

        const modeMap: Record<string, number> = { cool: 0, heat: 1, auto: 2, fan: 3, dry: 4 };
        const windMap: Record<string, number> = { auto: 0, low: 1, mid: 2, high: 3 };

        const body = {
          power: power ? 1 : 0,
          mode: modeMap[modeStr.toLowerCase()] ?? 0,
          temp: temp,
          wind: windMap[fanStr.toLowerCase()] ?? 0,
        };

        await callTuya(`/v2.0/infrareds/${HUB_ID}/air-conditioners/${remoteId}/scenes/command`, body);
      } else {
        const categoryId = config.categoryId;
        const remoteIndex = config.remoteIndex;

        if (categoryId == null || remoteIndex == null) {
          throw new Error(`[ir] device ${device.deviceId} missing categoryId or remoteIndex for TV/Soundbar`);
        }

        await callTuya(`/v2.0/infrareds/${HUB_ID}/remotes/${remoteId}/command`, {
          category_id: categoryId,
          remote_index: remoteIndex,
          key: input.command,
        });
      }
    } catch (err) {
      console.error(`[ir] Tuya cloud call failed:`, err);
      throw err; // Propagate error so frontend sees the failure
    }
  }
}
