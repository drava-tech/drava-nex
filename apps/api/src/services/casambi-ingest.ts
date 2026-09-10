import { listDevices, setDeviceState, setDeviceStatus, type Device } from "@platform/db";
import type { MQTTDeviceManager } from "@platform/iot";
import { broadcastToCms } from "../ws/gateway.js";

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

  // The gateway reports reachability on a separate topic. Without this the CMS
  // has no idea a fixture has dropped off the mesh — device.status stays
  // "unknown" forever and the UI keeps commanding a light that cannot answer,
  // which is exactly how target 17 died silently on 2026-09-02.
  mqtt.subscribe(`casambi/${network}/get/poll_device/+/propertys`, (topic, payload) => {
    void handlePropertysMessage(topic, payload);
  });
}

/** Mirror the mesh's reachability flag onto the device row (same shape as ir-ingest). */
async function handlePropertysMessage(topic: string, payload: Buffer): Promise<void> {
  const targetId = Number(topic.split("/")[4]);
  const device = targetIdToDevice.get(targetId);
  if (!device) return; // not a device we've registered — ignore

  let data: { online?: number; color_balance?: number };
  try {
    data = JSON.parse(payload.toString());
  } catch {
    return;
  }
  if (typeof data.online !== "number") return;

  // The fixture's White/Colour balance: 0 = all white LEDs, 255 = all RGB.
  // Persisted so the UI can tell the user why a colour command shows nothing —
  // a fixture in white mode ignores RGB entirely. It is NOT settable over this
  // gateway's MQTT interface (only the Casambi app and scenes change it), so
  // this is strictly for display.
  if (typeof data.color_balance === "number") {
    const prev = (device.state as { colorBalance?: number } | null)?.colorBalance;
    if (prev !== data.color_balance) {
      await setDeviceState(device.id, { ...(device.state ?? {}), colorBalance: data.color_balance })
        .catch((err) => console.error(`[casambi] failed to persist balance for ${device.deviceId}:`, err));
    }
  }

  const status = data.online === 1 ? "online" : "offline";
  if (device.status === status) return; // no churn on every poll tick

  try {
    await setDeviceStatus(device.deviceId, status);
    // Keep the cached row in step so the guard above keeps working until the
    // next cache refresh, which is up to a minute away.
    targetIdToDevice.set(targetId, { ...device, status });
    console.info(`[casambi] ${device.deviceId} (target ${targetId}) is now ${status}`);
  } catch (err) {
    console.error(`[casambi] failed to persist status for ${device.deviceId}:`, err);
  }
}

async function handleValuesMessage(topic: string, payload: Buffer): Promise<void> {
  const targetId = Number(topic.split("/")[4]);
  const device = targetIdToDevice.get(targetId);
  if (!device) return; // not a device we've registered — ignore

  let data: { level?: number; red?: number; green?: number; blue?: number; white?: number };
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
    // The fixture's dedicated white channel. Carried through so the CMS and the
    // reconciler can see a white contribution that RGB alone cannot express.
    white: typeof data.white === "number" ? data.white : 0,
  };

  // Skip no-op ticks, mirroring the `device.status === status` guard in the
  // propertys handler above. `poll_device/+/values` is a continuous stream —
  // during a fade or a scene recall it arrives at tens of messages a second per
  // fixture — and without this EVERY one of them did a Postgres UPDATE and a
  // JSON fan-out to every connected CMS socket, even when the level and colour
  // were byte-identical to what was already stored. This was the hottest write
  // path in the app, and it is driven by an external device we don't control.
  const prev = (device.state ?? {}) as Record<string, unknown>;
  const unchanged =
    prev["on"] === state.on &&
    prev["brightness"] === state.brightness &&
    prev["color"] === state.color &&
    prev["white"] === state.white;
  if (unchanged) return;

  try {
    // MERGE, don't replace: colorBalance is written by the propertys handler
  // above and would otherwise be wiped on every values tick.
    const updated = await setDeviceState(device.id, { ...prev, ...state });
    // Keep the cached row in step so the guard above keeps working until the
    // next cache refresh — same reason as the status handler's cache write.
    targetIdToDevice.set(targetId, { ...device, state: updated.state });
    broadcastToCms({ type: "LIGHT_STATE_UPDATE", deviceId: device.deviceId, state: updated.state });
  } catch (err) {
    console.error(`[casambi] failed to persist live state for ${device.deviceId}:`, err);
  }
}
