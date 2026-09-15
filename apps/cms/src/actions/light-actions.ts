"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

export interface LightStateInput {
  on: boolean;
  brightness?: number;
  color?: string;
  /** 0-255 on the fixture's dedicated white channel; the driver derives one if omitted. */
  white?: number;
}

export interface LightSummary {
  uuid: string;
  deviceId: string;
  name: string;
  /** 'online' | 'offline' | 'unknown', maintained by the Casambi ingest. */
  status: string;
  state: { on?: boolean; brightness?: number; color?: string; white?: number; colorBalance?: number };
}

/**
 * Every registered Casambi light, read from the API rather than hardcoded.
 *
 * The fixture list used to live as literal row uuids in the client, which broke
 * twice as the mesh changed underneath it (targets 12/13 went offline, then 17).
 * Reading it here means adding or losing a fixture is a `seed:casambi` run
 * instead of a code change and a redeploy.
 */
export async function listLights(): Promise<LightSummary[]> {
  await requireAdmin();
  const res = await apiFetch<Array<{
    id: string;
    deviceId: string;
    name: string;
    type: string;
    status: string;
    state: Record<string, unknown> | null;
    config: Record<string, unknown> | null;
  }>>("/api/devices", { method: "GET" });
  if (!res.ok) throw new Error(res.error.message);

  return res.data
    .filter((d) => (d.config as { driver?: string } | null)?.driver === "casambi")
    .map((d) => ({
      uuid: d.id,
      deviceId: d.deviceId,
      name: d.name,
      status: d.status,
      state: (d.state ?? {}) as LightSummary["state"],
    }));
}

export async function setLightState(deviceUuid: string, state: LightStateInput) {
  await requireAdmin();
  const res = await apiFetch<{ success: boolean }>(`/api/devices/lights/${deviceUuid}/state`, {
    method: "POST",
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}

export async function identifyLight(deviceUuid: string) {
  await requireAdmin();
  const res = await apiFetch<{ identified: boolean }>(`/api/devices/lights/${deviceUuid}/identify`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}

export async function getLightState(deviceUuid: string) {
  await requireAdmin();
  const res = await apiFetch<{
    id: string;
    deviceId: string;
    status: string;
    state: { on?: boolean; brightness?: number; color?: string };
  }>(`/api/devices/${deviceUuid}/status`, { method: "GET" });
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}

/**
 * Recall a scene defined in the Casambi network itself.
 *
 * Used to move fixtures between warm and colour mode — a scene carries the
 * White/Colour balance, which no direct light command can set.
 */
export async function recallCasambiScene(scene: number, level = 255) {
  await requireAdmin();
  const res = await apiFetch<{ recalled: number }>("/api/devices/lights/casambi-scene", {
    method: "POST",
    body: JSON.stringify({ scene, level }),
  });
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}
