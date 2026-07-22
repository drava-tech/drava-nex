import { listDevices, setDeviceStatus, type Device } from "@platform/db";
import type { MQTTDeviceManager } from "@platform/iot";
import { broadcastToCms } from "../ws/gateway.js";

/**
 * Reflects the CrabController IR bridge's outbound MQTT into the CMS so the
 * Climate panel / Remotes overlay stay live. The bridge publishes:
 *
 *   twt/av/ir/status  (retained)  "online" | "offline"   — service LWT
 *   twt/av/ir/ack     (QoS 1)     { device, command, status: "ok"|"error", detail }
 *
 * Unlike the Casambi ingest, the bridge does not report full appliance state
 * back (a Tuya IR AC has no state feedback path), so the CMS's own optimistic
 * state is authoritative — here we only surface online/offline and failed acks.
 */

const DEVICE_CACHE_REFRESH_MS = 60_000;

// Bridge-side remote name (config.irDevice) → CMS device row.
let irDeviceToDevice = new Map<string, Device>();

async function refreshDeviceCache(): Promise<void> {
  const devices = await listDevices();
  const next = new Map<string, Device>();
  for (const device of devices) {
    const config = device.config as { driver?: string; irDevice?: string } | null;
    if (config?.driver === "ir" && typeof config.irDevice === "string") {
      next.set(config.irDevice, device);
    }
  }
  irDeviceToDevice = next;
}

export async function startIrIngest(mqtt: MQTTDeviceManager): Promise<void> {
  if (!process.env["IR_ENABLED"]) {
    console.warn("[ir] ingest disabled — IR_ENABLED not set");
    return;
  }

  const statusTopic = process.env["IR_STATUS_TOPIC"] ?? "twt/av/ir/status";
  const ackTopic = process.env["IR_ACK_TOPIC"] ?? "twt/av/ir/ack";

  await refreshDeviceCache().catch((err) => console.error("[ir] initial device cache load failed:", err));
  setInterval(() => {
    refreshDeviceCache().catch((err) => console.error("[ir] device cache refresh failed:", err));
  }, DEVICE_CACHE_REFRESH_MS);

  mqtt.subscribe(statusTopic, (_topic, payload) => {
    void handleStatusMessage(payload);
  });
  mqtt.subscribe(ackTopic, (_topic, payload) => {
    void handleAckMessage(payload);
  });

  console.info(`[ir] ingest listening on ${statusTopic} + ${ackTopic}`);
}

async function handleStatusMessage(payload: Buffer): Promise<void> {
  const raw = payload.toString().trim().replace(/^"|"$/g, "");
  const status = raw === "online" ? "online" : "offline";

  for (const device of irDeviceToDevice.values()) {
    try {
      await setDeviceStatus(device.deviceId, status);
      broadcastToCms({ type: "IR_STATE_UPDATE", deviceId: device.deviceId, status });
    } catch (err) {
      console.error(`[ir] failed to apply status for ${device.deviceId}:`, err);
    }
  }
}

async function handleAckMessage(payload: Buffer): Promise<void> {
  let ack: { device?: string; command?: string; status?: string; detail?: string };
  try {
    ack = JSON.parse(payload.toString());
  } catch {
    return;
  }

  const device = ack.device ? irDeviceToDevice.get(ack.device) : undefined;
  if (!device) return; // ack for a remote we haven't registered — ignore

  if (ack.status === "error") {
    console.error(`[ir] bridge reported error for ${device.deviceId}/${ack.command}: ${ack.detail ?? ""}`);
    broadcastToCms({ type: "IR_STATE_UPDATE", deviceId: device.deviceId, status: "error" });
  }
}
