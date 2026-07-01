import { randomUUID } from "crypto";
import type { Device } from "@platform/db";
import type { DeviceCommand, LightState } from "@platform/types";

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
}

// MQTT publisher is injected at startup (see apps/api/src/index.ts) to avoid a
// circular import with the gateway/manager. Null until wired.
type Publisher = (deviceId: string, command: DeviceCommand) => void;
let mqttPublish: Publisher | null = null;

export function setMqttPublisher(fn: Publisher): void {
  mqttPublish = fn;
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
  if (driver === "mqtt" && mqttPublish) return mqttDriver;
  return noopDriver;
}
