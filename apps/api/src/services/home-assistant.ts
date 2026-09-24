/**
 * Home Assistant REST API client for the physical door lock (an
 * HA-integrated Yale smart lock). This is the sole source of truth for both
 * actuation (setHomeAssistantLockState) and status (getHomeAssistantLockState).
 *
 * The lock's entity id is auto-discovered from Home Assistant's own entity
 * list rather than pinned in config: there is exactly one lock in this
 * deployment, so asking Home Assistant "which entity is the lock" on every
 * call is strictly more robust than hardcoding an id that would go stale the
 * moment it's renamed in HA. HA_ENTITY_ID remains a supported override for a
 * deployment with more than one lock, where auto-discovery is ambiguous.
 */

import type { MQTTDeviceManager } from "@platform/iot";
import { recordDoorEvent, listDoorEvents } from "@platform/db";
import { broadcastToCms } from "../ws/gateway.js";

export class HomeAssistantError extends Error {}

// Bare fetch() has no timeout — if HA is unreachable via a black-holed route
// (as opposed to an immediate connection refusal), the request hangs
// indefinitely and so does whatever's waiting on it (the voice agent gives up
// after 8s regardless and reports failure, but without this the underlying
// HA call would still be running, possibly actuating the lock seconds later
// with no way to know it happened).
const HA_FETCH_TIMEOUT_MS = 5_000;

function haUnreachableError(url: string, err: unknown): HomeAssistantError {
  return new HomeAssistantError(
    err instanceof Error && err.name === "TimeoutError"
      ? `Home Assistant at ${url} did not respond within ${HA_FETCH_TIMEOUT_MS}ms.`
      : `Could not reach Home Assistant at ${url}: ${err instanceof Error ? err.message : String(err)}`
  );
}

export interface HomeAssistantLockState {
  state: "locked" | "unlocked";
  changedBy: string | null;
  lastChanged: string;
}

interface ResolvedConfig {
  url: string;
  token: string;
  entityId: string;
}

/** Ask Home Assistant for its entity list and pick out the one lock. */
async function discoverLockEntityId(url: string, token: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${url}/api/states`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(HA_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw haUnreachableError(url, err);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HomeAssistantError(`Home Assistant entity list fetch failed (${res.status}): ${body}`);
  }
  const states = (await res.json()) as { entity_id: string }[];
  const locks = states.filter((s) => s.entity_id.startsWith("lock."));
  if (locks.length === 0) {
    throw new HomeAssistantError("No lock entity found in Home Assistant.");
  }
  if (locks.length > 1) {
    throw new HomeAssistantError(
      `Multiple lock entities found in Home Assistant (${locks.map((l) => l.entity_id).join(", ")}) — ` +
        "set HA_ENTITY_ID to pick which one this deployment controls."
    );
  }
  return locks[0]!.entity_id;
}

async function resolveConfig(): Promise<ResolvedConfig> {
  const url = process.env["HA_URL"];
  const token = process.env["HA_TOKEN"];
  if (!url || !token) {
    throw new HomeAssistantError("Home Assistant is not configured (HA_URL/HA_TOKEN).");
  }
  const trimmedUrl = url.replace(/\/+$/, "");
  const entityId = process.env["HA_ENTITY_ID"] || (await discoverLockEntityId(trimmedUrl, token));
  return { url: trimmedUrl, token, entityId };
}

export async function setHomeAssistantLockState(
  action: "locked" | "unlocked",
  resolved?: ResolvedConfig
): Promise<void> {
  const { url, token, entityId } = resolved ?? (await resolveConfig());
  const service = action === "locked" ? "lock" : "unlock";

  let res: Response;
  try {
    res = await fetch(`${url}/api/services/lock/${service}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ entity_id: entityId }),
      signal: AbortSignal.timeout(HA_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw haUnreachableError(url, err);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HomeAssistantError(`Home Assistant ${service} call failed (${res.status}): ${body}`);
  }
}

export async function getHomeAssistantLockState(): Promise<HomeAssistantLockState> {
  const { url, token, entityId } = await resolveConfig();

  let res: Response;
  try {
    res = await fetch(`${url}/api/states/${entityId}`, {
      headers: { Authorization: `Bearer ${token}` },
      // Never cache a physical lock's state.
      cache: "no-store",
      signal: AbortSignal.timeout(HA_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    throw haUnreachableError(url, err);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HomeAssistantError(`Home Assistant state fetch failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    state: string;
    attributes?: { changed_by?: string | null };
    last_changed: string;
  };

  if (data.state !== "locked" && data.state !== "unlocked") {
    throw new HomeAssistantError(`Unexpected lock state from Home Assistant: "${data.state}"`);
  }

  return {
    state: data.state,
    changedBy: data.attributes?.changed_by ?? null,
    lastChanged: data.last_changed,
  };
}

// Injected at startup (see apps/api/src/index.ts), same pattern as
// services/devices.ts's setMqttManager — avoids a circular import with the
// manager itself.
let doorLockMqtt: MQTTDeviceManager | null = null;

export function setDoorLockMqttManager(mgr: MQTTDeviceManager): void {
  doorLockMqtt = mgr;
}

/**
 * Actuate the physical lock via Home Assistant, publish the resulting state
 * to MQTT for any local IoT listeners, record the event, and tell CMS tabs.
 * Shared by /api/door-events' POST /toggle (a CMS operator's click) and the
 * internal voice-command route (apps/api/src/routes/voice-internal.ts) — one
 * implementation, two callers.
 */
export async function toggleDoorLock(action: "locked" | "unlocked", source: "voice" | "cms" = "cms") {
  const resolved = await resolveConfig();
  const lockId = resolved.entityId;

  await setHomeAssistantLockState(action, resolved);

  const topic = `cms/door/${lockId}/unlocked`;
  const value = action === "unlocked" ? "true" : "false";
  const publish = doorLockMqtt?.publishRaw(topic, value, { qos: 1, retain: true });
  publish?.catch((err) => console.error("[home-assistant] door lock MQTT publish failed:", err));

  const event = await recordDoorEvent(lockId, action, source);
  const { total } = await listDoorEvents(1);
  broadcastToCms({
    type: "DOOR_EVENT",
    id: event.id,
    lockId: event.lockId,
    action: event.action as "locked" | "unlocked",
    createdAt: event.createdAt.toISOString(),
    total,
  });
  return event;
}
