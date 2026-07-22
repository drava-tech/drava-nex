"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

/**
 * Server actions that drive IR appliances through the CrabController bridge.
 * Each forwards the admin session to the Hono API (POST /api/devices/ir/:uuid/
 * command), which publishes to MQTT — the CMS never touches the broker directly.
 * Mirrors apps/cms/src/actions/light-actions.ts.
 */

async function postIrCommand(deviceUuid: string, command: string, params?: Record<string, unknown>) {
  await requireAdmin();
  const res = await apiFetch<{ id: string; state: Record<string, unknown> }>(
    `/api/devices/ir/${deviceUuid}/command`,
    {
      method: "POST",
      body: JSON.stringify({ command, ...(params ? { params } : {}) }),
    }
  );
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}

/** Generic passthrough — any bridge command + params. */
export async function sendIrCommand(deviceUuid: string, command: string, params?: Record<string, unknown>) {
  return postIrCommand(deviceUuid, command, params);
}

/** Read a device's last-known persisted state — used to hydrate the Climate panel on load. */
export async function getIrDeviceState(deviceUuid: string) {
  await requireAdmin();
  const res = await apiFetch<{
    id: string;
    deviceId: string;
    status: string;
    state: Record<string, unknown>;
  }>(`/api/devices/${deviceUuid}/status`, { method: "GET" });
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}

// ── AC convenience wrappers ─────────────────────────────────────────────────

export async function acPower(deviceUuid: string, on: boolean) {
  return postIrCommand(deviceUuid, on ? "power_on" : "power_off");
}

export async function acSetTemp(deviceUuid: string, temp: number) {
  return postIrCommand(deviceUuid, "set_temp", { temp });
}

/** mode ∈ cool|heat|auto|fan|dry (bridge vocabulary). */
export async function acSetMode(deviceUuid: string, mode: string) {
  return postIrCommand(deviceUuid, "set_mode", { mode });
}

/** fan ∈ auto|low|mid|high (bridge vocabulary). */
export async function acSetFan(deviceUuid: string, fan: string) {
  return postIrCommand(deviceUuid, "set_fan", { fan });
}

/** A codebook key press on a non-AC remote (TV/soundbar/…). */
export async function sendRemoteKey(deviceUuid: string, key: string) {
  return postIrCommand(deviceUuid, key);
}
