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

/** Below this HSV saturation a colour is treated as white rather than a hue. */
const ACHROMATIC_SAT = 0.25;

/**
 * Map a requested colour onto what these fixtures can actually render.
 *
 * Measured on the mesh: the RGB path always renders a FULLY SATURATED hue —
 * saturation comes back as 254 no matter what is sent. A colour therefore
 * cannot be "slightly tinted" here: any non-zero RGB shows as a vivid hue at
 * full strength. The dedicated W channel does work, and both units accept it.
 *
 * The naive RGB->RGBW split (w = min(r,g,b), RGB keeps the remainder) is wrong
 * for this hardware and was tried first: warm white became white=224 plus an
 * RGB remainder of (31,19,0) that the fixture rendered as saturated red, i.e.
 * a red splash over the white instead of a warm tint.
 *
 * So the channels are used exclusively rather than blended — near-neutral
 * colours go to W alone, saturated colours to RGB alone. That is the whole
 * gamut these fixtures have: clean whites, or vivid hues.
 */
function toFixtureChannels(r: number, g: number, b: number): { r: number; g: number; b: number; w: number } {
  const max = Math.max(r, g, b);
  const sat = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
  if (sat < ACHROMATIC_SAT) return { r: 0, g: 0, b: 0, w: max };
  return { r, g, b, w: 0 };
}

/**
 * Measured on the mesh: a green command reads back as blue and a blue command
 * reads back as green, with red unaffected — consistently, on both units.
 *
 * What cannot be determined from MQTT alone is WHICH side is swapped. If the
 * command path is swapped the fixture genuinely lights blue and this must
 * compensate; if only the gateway's readback is swapped the fixture is already
 * correct and compensating here would break it. Both cases produce identical
 * traffic, so only someone looking at the fixture can tell them apart.
 *
 * Left false (existing behaviour, no regression risk). To resolve: send green
 * and look at the light — if it shows blue, set this true.
 */
const SWAP_GREEN_BLUE = false;

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
      // Broker down or slow: mqtt.js still queues the packet client-side and
      // will flush it on reconnect, so the command usually isn't lost — but it
      // also isn't confirmed *now*, and we must not tell the caller it is.
      // Swallowing this used to make setLightState/triggerMeshScene resolve
      // successfully during an outage, so the voice agent (and a human) would
      // hear "done" seconds before anything actually happened — or, if the
      // process restarts before the broker reconnects, forever, since mqtt.js's
      // queue is in-memory only. Surfacing it instead lets the real caller
      // (applyLightState etc.) propagate an honest failure.
      console.error(`[casambi] publish to ${topic} did not ack in time:`, err);
      throw new Error(
        `Lights didn't confirm the change in time (mesh network may be slow or offline). The command is queued and may still apply once it reconnects.`
      );
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
        // An explicit white wins; otherwise derive it, so whites actually reach
        // the one channel that can render them.
        const split = toFixtureChannels(rgb.r, rgb.g, rgb.b);
        const white = clamp255(state.white ?? split.w);
        await this.publish(`casambi/${network}/set/target_rgbw`, {
          red: split.r,
          green: SWAP_GREEN_BLUE ? split.b : split.g,
          blue: SWAP_GREEN_BLUE ? split.g : split.b,
          white,
          level,
          targetid: targetId,
          targettype: targetType,
        });
      }
    }

    // target_rgbw only drives the colour mixer — on the DALI drivers the dimmer
    // ignores its `level` field entirely (verified on the mesh: an rgbw publish
    // changed red/green/blue but left level at 0). So the level always has to
    // follow on its own topic, or a coloured command would never actually turn
    // the fixture on or off.
    await this.publish(`casambi/${network}/set/target_level`, {
      targetid: targetId,
      level,
      targettype: targetType,
      duration: 1, // 10ms units — near-instant, feels responsive for a UI slider
    });
  }

  /**
   * Recall a scene defined in the Casambi network itself (not a CMS "scene" row).
   *
   * This is the ONLY way to change a fixture's White/Colour balance from here:
   * a Casambi scene stores that balance as part of itself, whereas no direct
   * MQTT command sets it — verified by probing every topic the gateway
   * subscribes to. Measured: scene 2/3 move the fabrics into colour mode
   * (balance 0 -> 255) and scene 1 returns them to warm (255 -> 0).
   */
  async triggerMeshScene(sceneId: number, level = 255): Promise<void> {
    const network = process.env["CASAMBI_NETWORK_ID"];
    if (!network) {
      console.warn("[casambi] cannot recall scene — CASAMBI_NETWORK_ID not set");
      return;
    }
    await this.publish(`casambi/${network}/set/scene_level`, {
      scene: sceneId,
      level,
      duration: 1,
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
