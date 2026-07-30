import { listDevices, setDeviceState, type Device } from "@platform/db";
import type { MQTTDeviceManager } from "@platform/iot";
import { broadcastToCms, broadcastToUe } from "../ws/gateway.js";

/**
 * Subscribes to the Casambi gateway's per-device "values" topic so the CMS
 * reflects real-world changes (wall switch, Casambi app, another user) — not
 * just commands the CMS itself sent. See Casambi_MQTT_EXTIF_CheatSheet §1.2:
 * casambi/<net>/get/poll_device/<id>/values, level/red/green/blue are 0-255.
 */

const DEVICE_CACHE_REFRESH_MS = 60_000;

let targetIdToDevice = new Map<number, Device>();

async function refreshDeviceCache(): Promise<void> {
  const devices = await listDevices();
  const next = new Map<number, Device>();
  for (const device of devices) {
    const config = device.config as { driver?: string; targetId?: number } | null;
    if (config?.driver === "casambi" && typeof config.targetId === "number") {
      next.set(config.targetId, device);
    }
  }
  targetIdToDevice = next;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => clampByte(v).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

export async function startCasambiIngest(mqtt: MQTTDeviceManager): Promise<void> {
  const network = process.env["CASAMBI_NETWORK_ID"];
  if (!network) {
    console.warn("[casambi] ingest disabled — CASAMBI_NETWORK_ID not set");
    return;
  }

  await refreshDeviceCache().catch((err) => console.error("[casambi] initial device cache load failed:", err));
  setInterval(() => {
    refreshDeviceCache().catch((err) => console.error("[casambi] device cache refresh failed:", err));
  }, DEVICE_CACHE_REFRESH_MS);

  mqtt.subscribe(`casambi/${network}/get/poll_device/+/values`, (topic, payload) => {
    void handleValuesMessage(topic, payload);
  });
}

async function handleValuesMessage(topic: string, payload: Buffer): Promise<void> {
  const targetId = Number(topic.split("/")[4]);
  const device = targetIdToDevice.get(targetId);
  if (!device) return; // not a device we've registered — ignore

  let data: { level?: number; red?: number; green?: number; blue?: number };
  try {
    data = JSON.parse(payload.toString());
  } catch {
    return;
  }

  const level = typeof data.level === "number" ? data.level : 0;
  const brightness = Math.round((level / 255) * 100);
  const state = {
    on: level > 0,
    brightness,
    color: rgbToHex(data.red ?? 0, data.green ?? 0, data.blue ?? 0),
  };

  try {
    const updated = await setDeviceState(device.id, state);
    broadcastToCms({ type: "LIGHT_STATE_UPDATE", deviceId: device.deviceId, state: updated.state });
    broadcastToUe({
      type: "LIGHT_STATE_CHANGED",
      deviceId: device.deviceId,
      state: updated.state,
      timestamp: Date.now(),
    });
  } catch (err) {
    console.error(`[casambi] failed to persist live state for ${device.deviceId}:`, err);
  }
}
