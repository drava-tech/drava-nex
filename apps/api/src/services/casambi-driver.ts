import type { MQTTDeviceManager } from "@platform/iot";
import type { Device } from "@platform/db";
import type { LightState } from "@platform/types";
import type { DeviceDriver } from "./devices.js";

/**
 * Driver for lights behind a Lithernet Casambi Gateway. Publishes straight to
 * the gateway's MQTT bridge, bypassing the generic MQTTDeviceManager.publishCommand
 * indirection — that stub has no way to carry the network/targetId a Casambi
 * command needs. Topic/payload shapes are from the gateway's own MQTT cheat
 * sheet: "level" fields are 0-255 (NOT 0-100 — the CMS's LightState.brightness
 * is 0-100 and must be scaled), "duration" is in 10ms units.
 */

const PUBLISH_ACK_TIMEOUT_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export class CasambiDeviceDriver implements DeviceDriver {
  constructor(private readonly mqtt: MQTTDeviceManager) {}

  private target(device: Device): { network: string; targetId: number; targetType: number } | null {
    const network = process.env["CASAMBI_NETWORK_ID"];
    const config = device.config as { targetId?: number; targetType?: number } | null;
    const targetId = config?.targetId;
    if (!network || targetId === undefined) {
      console.warn(`[casambi] device ${device.deviceId} missing network/targetId — skipping publish`);
      return null;
    }
    return { network, targetId, targetType: config?.targetType ?? 1 };
  }

  private async publish(topic: string, payload: Record<string, unknown>): Promise<void> {
    try {
      await Promise.race([
        this.mqtt.publishRaw(topic, JSON.stringify(payload), { qos: 1 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("ack timeout")), PUBLISH_ACK_TIMEOUT_MS)
        ),
      ]);
    } catch (err) {
      // Broker down or slow: mqtt.js still queues/flushes on reconnect, so this
      // is a delivery delay, not a lost command — don't fail the caller over it.
      console.error(`[casambi] publish to ${topic} did not ack in time:`, err);
    }
  }

  async setLightState(device: Device, state: LightState): Promise<void> {
    const target = this.target(device);
    if (!target) return;
    const { network, targetId, targetType } = target;

    const level = state.on ? clamp255(((state.brightness ?? 100) / 100) * 255) : 0;

    if (state.color) {
      const rgb = hexToRgb(state.color);
      if (rgb) {
        await this.publish(`casambi/${network}/set/target_rgbw`, {
          red: rgb.r,
          green: rgb.g,
          blue: rgb.b,
          white: 0,
          level,
          targetid: targetId,
          targettype: targetType,
        });
        return;
      }
    }

    await this.publish(`casambi/${network}/set/target_level`, {
      targetid: targetId,
      level,
      targettype: targetType,
      duration: 1, // 10ms units — near-instant, feels responsive for a UI slider
    });
  }

  async triggerScene(device: Device): Promise<void> {
    console.info(`[casambi] (noop) triggerScene ${device.deviceId} — target_level has no scene concept`);
  }

  /** Flash the light 3x so the user can visually identify which fixture this device is, then restore its prior level. */
  async identify(device: Device): Promise<void> {
    const target = this.target(device);
    if (!target) return;
    const { network, targetId, targetType } = target;
    const topic = `casambi/${network}/set/target_level`;
    const priorBrightness = (device.state as { brightness?: number } | null)?.brightness ?? 100;
    const priorLevel = clamp255((priorBrightness / 100) * 255);

    for (let i = 0; i < 3; i++) {
      await this.publish(topic, { targetid: targetId, level: 255, targettype: targetType, duration: 1 });
      await sleep(220);
      await this.publish(topic, { targetid: targetId, level: 0, targettype: targetType, duration: 1 });
      await sleep(220);
    }
    await this.publish(topic, { targetid: targetId, level: priorLevel, targettype: targetType, duration: 1 });
  }
}
