import { randomUUID } from "crypto";
import { setDeviceState, type Device } from "@platform/db";
import type { DeviceCommand, LightState } from "@platform/types";
import type { MQTTDeviceManager } from "@platform/iot";
import { CasambiDeviceDriver } from "./casambi-driver.js";
import { IrDeviceDriver } from "./ir-driver.js";
import { broadcastToCms } from "../ws/gateway.js";

/**
 * Device control is abstracted behind a driver so the REST contract
 * (/api/devices) stays stable while the real transport is decided later.
 * Today: an MQTT driver (wraps the placeholder MQTTDeviceManager) and a no-op
 * driver for unconfigured devices. DMX / OSC / vendor SDK drivers slot in here
 * by implementing DeviceDriver — no route changes needed ("wire hardware later").
 */
export interface DeviceDriver {
  setLightState(device: Device, state: LightState): Promise<void>;
  triggerScene(device: Device): Promise<void>;
  /** Optional: briefly flash/pulse the physical device so a user can visually identify it. */
  identify?(device: Device): Promise<void>;
}

// MQTT publisher is injected at startup (see apps/api/src/index.ts) to avoid a
// circular import with the gateway/manager. Null until wired.
type Publisher = (deviceId: string, command: DeviceCommand) => void;
let mqttPublish: Publisher | null = null;

export function setMqttPublisher(fn: Publisher): void {
  mqttPublish = fn;
}

// The Casambi driver needs the manager itself (publishRaw), not the generic
// publishCommand indirection above — same injection pattern, different setter.
let casambiDriver: CasambiDeviceDriver | null = null;

export function setMqttManager(mgr: MQTTDeviceManager): void {
  casambiDriver = new CasambiDeviceDriver(mgr);
}

// IR verbs (power_on/set_temp/codebook keys) don't fit the light-centric
// DeviceDriver interface, so the IR driver lives in its own registry with a
// parallel getter used by the /api/devices/ir route. Same startup injection.
let irDriver: IrDeviceDriver | null = null;

export function setIrManager(mgr: MQTTDeviceManager): void {
  irDriver = new IrDeviceDriver(mgr);
}

/** The Casambi driver, for operations that are not per-device (mesh scenes). */
export function getCasambiDriver(): CasambiDeviceDriver | null {
  return casambiDriver;
}

/** The IR driver, once wired at startup (see apps/api/src/index.ts). */
export function getIrDriver(): IrDeviceDriver | null {
  return irDriver;
}

function command(deviceId: string, action: string, payload?: Record<string, unknown>): DeviceCommand {
  return { commandId: randomUUID(), deviceId, action, ...(payload ? { payload } : {}), sentAt: Date.now() };
}

class MqttDeviceDriver implements DeviceDriver {
  async setLightState(device: Device, state: LightState): Promise<void> {
    mqttPublish?.(device.deviceId, command(device.deviceId, "SET_LIGHT_STATE", { ...state }));
  }
  async triggerScene(device: Device): Promise<void> {
    mqttPublish?.(device.deviceId, command(device.deviceId, "TRIGGER_SCENE"));
  }
}

class NoopDeviceDriver implements DeviceDriver {
  async setLightState(device: Device, state: LightState): Promise<void> {
    console.info(`[devices] (noop) setLightState ${device.deviceId}`, state);
  }
  async triggerScene(device: Device): Promise<void> {
    console.info(`[devices] (noop) triggerScene ${device.deviceId}`);
  }
}

const mqttDriver = new MqttDeviceDriver();
const noopDriver = new NoopDeviceDriver();

/** Pick a driver for a device. `config.driver` selects it; defaults to no-op. */
export function getDeviceDriver(device: Device): DeviceDriver {
  const driver = (device.config as { driver?: string } | null)?.driver;
  if (driver === "casambi" && casambiDriver) return casambiDriver;
  if (driver === "mqtt" && mqttPublish) return mqttDriver;
  return noopDriver;
}
/**
 * Drive one light's real hardware, persist the resulting state, and tell
 * both the CMS and UE about it.
 */
export async function applyLightState(device: Device, state: LightState): Promise<Device> {
  const merged = { ...(device.state ?? {}), ...state };
  await getDeviceDriver(device).setLightState(device, merged);
  const updated = await setDeviceState(device.id, merged);
  broadcastToCms({ type: "LIGHT_STATE_UPDATE", deviceId: device.deviceId, state: updated.state });
  return updated;
}

