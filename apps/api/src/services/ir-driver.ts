import type { MQTTDeviceManager } from "@platform/iot";
import type { Device } from "@platform/db";

/**
 * Driver for IR appliances behind the CrabController bridge
 * (D:\GitHub\White Tusker\2026\CrabController — `python -m ir_controller.service`).
 * The bridge subscribes to a single command topic and fans commands out to a
 * Tuya IR hub; the CMS only speaks its MQTT contract:
 *
 *   publish  twt/av/ir/command  (QoS 1)  { device, command, params }
 *
 * `device.config.irDevice` is the bridge-side remote name ("ac", "tv", …). The
 * AC verb vocabulary is power_on|power_off|set_temp{temp}|set_mode{mode}|
 * set_fan{fan}; any other remote uses a codebook key as the `command`. This is
 * command-only — inbound acks/status are handled by ir-ingest.ts.
 */

const PUBLISH_ACK_TIMEOUT_MS = 2_000;

function commandTopic(): string {
  return process.env["IR_COMMAND_TOPIC"] ?? "twt/av/ir/command";
}

export interface IrCommandInput {
  command: string;
  params?: Record<string, unknown>;
}

export class IrDeviceDriver {
  constructor(private readonly mqtt: MQTTDeviceManager) {}

  private target(device: Device): string | null {
    const config = device.config as { irDevice?: string } | null;
    const irDevice = config?.irDevice;
    if (!irDevice) {
      console.warn(`[ir] device ${device.deviceId} missing config.irDevice — skipping publish`);
      return null;
    }
    return irDevice;
  }

  async sendCommand(device: Device, input: IrCommandInput): Promise<void> {
    const irDevice = this.target(device);
    if (!irDevice) return;

    const payload = {
      device: irDevice,
      command: input.command,
      ...(input.params ? { params: input.params } : {}),
    };

    try {
      await Promise.race([
        this.mqtt.publishRaw(commandTopic(), JSON.stringify(payload), { qos: 1 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("ack timeout")), PUBLISH_ACK_TIMEOUT_MS)
        ),
      ]);
    } catch (err) {
      // Broker down or slow: mqtt.js still queues/flushes on reconnect, so this
      // is a delivery delay, not a lost command — don't fail the caller over it.
      console.error(`[ir] publish to ${commandTopic()} did not ack in time:`, err);
    }
  }
}
