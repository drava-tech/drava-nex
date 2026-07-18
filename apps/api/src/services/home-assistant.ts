/**
 * Home Assistant REST API client for the physical door lock (entity
 * HA_ENTITY_ID — an HA-integrated Yale smart lock). This is the sole source
 * of truth for both actuation (setHomeAssistantLockState) and status
 * (getHomeAssistantLockState) — the Yale IFTTT webhook (yale.ts) is legacy
 * and no longer consulted for either.
 */

export class HomeAssistantError extends Error {}

export interface HomeAssistantLockState {
  state: "locked" | "unlocked";
  changedBy: string | null;
  lastChanged: string;
}

function requireConfig(): { url: string; token: string; entityId: string } {
  const url = process.env["HA_URL"];
  const token = process.env["HA_TOKEN"];
  const entityId = process.env["HA_ENTITY_ID"];
  if (!url || !token || !entityId) {
    throw new HomeAssistantError(
      "Home Assistant is not configured (HA_URL/HA_TOKEN/HA_ENTITY_ID)."
    );
  }
  return { url: url.replace(/\/+$/, ""), token, entityId };
}

export async function setHomeAssistantLockState(action: "locked" | "unlocked"): Promise<void> {
  const { url, token, entityId } = requireConfig();
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
    });
  } catch (err) {
    throw new HomeAssistantError(
      `Could not reach Home Assistant at ${url}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new HomeAssistantError(`Home Assistant ${service} call failed (${res.status}): ${body}`);
  }
}

export async function getHomeAssistantLockState(): Promise<HomeAssistantLockState> {
  const { url, token, entityId } = requireConfig();

  let res: Response;
  try {
    res = await fetch(`${url}/api/states/${entityId}`, {
      headers: { Authorization: `Bearer ${token}` },
      // Never cache a physical lock's state.
      cache: "no-store",
    });
  } catch (err) {
    throw new HomeAssistantError(
      `Could not reach Home Assistant at ${url}: ${err instanceof Error ? err.message : String(err)}`
    );
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
