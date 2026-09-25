import type { MQTTDeviceManager } from "@platform/iot";
import { recordDoorEvent, listDoorEvents } from "@platform/db";
import { broadcastToCms } from "../ws/gateway.js";
import { setHomeAssistantLockState } from "./home-assistant.js";

/**
 * Lock or unlock the door: actuate via Home Assistant (the source of truth),
 * then mirror the state to MQTT, record the event and tell the CMS. Shared by
 * the CMS's manual toggle (routes/door-events.ts) and voice control
 * (routes/voice-control.ts) so both take exactly the same path.
 *
 * Throws if Home Assistant fails — nothing is published or recorded then.
 * Recording/broadcasting failures after a successful actuation are logged,
 * not thrown: the door did move.
 */
export async function setDoorLock(
  mqtt: MQTTDeviceManager,
  action: "locked" | "unlocked",
  logTag = "door-events-manual"
): Promise<void> {
  // HA_ENTITY_ID (checked inside setHomeAssistantLockState) is what's actually
  // required; this is only a human-readable label for the event/MQTT topic.
  const lockId = process.env["HA_ENTITY_ID"] ?? "home-assistant-lock";

  await setHomeAssistantLockState(action);

  const topic = `cms/door/${lockId}/unlocked`;
  const value = action === "unlocked" ? "true" : "false";
  // Publish state to the broker so physical/logical local IoT devices sync
  mqtt
    .publishRaw(topic, value, { qos: 1, retain: true })
    .catch((err) => console.error(`[${logTag}] publish failed:`, err));

  try {
    const event = await recordDoorEvent(lockId, action);
    console.info(`[${logTag}] door event recorded: ${action} at ${event.createdAt.toISOString()}`);
    const { total } = await listDoorEvents(1);
    broadcastToCms({
      type: "DOOR_EVENT",
      id: event.id,
      lockId: event.lockId,
      action: event.action as "locked" | "unlocked",
      createdAt: event.createdAt.toISOString(),
      total,
    });
  } catch (err) {
    console.error(`[${logTag}] failed to record/broadcast door event:`, err);
  }
}
