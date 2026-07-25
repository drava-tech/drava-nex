"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

export interface ModeTargetState {
  on: boolean;
  brightness?: number;
  color?: string;
}

export interface ModeSummary {
  id: string;
  deviceId: string;
  name: string;
  targets: Record<string, ModeTargetState>;
}

interface DeviceRow {
  id: string;
  deviceId: string;
  name: string;
  type: string;
  config: Record<string, unknown> | null;
}

function toModeSummary(d: DeviceRow): ModeSummary {
  const targets = (d.config as { targets?: Record<string, ModeTargetState> } | null)?.targets ?? {};
  return { id: d.id, deviceId: d.deviceId, name: d.name, targets };
}

export async function listModes(): Promise<ModeSummary[]> {
  await requireAdmin();
  const res = await apiFetch<DeviceRow[]>("/api/devices");
  if (!res.ok) throw new Error(res.error.message);
  return res.data.filter((d) => d.type === "scene").map(toModeSummary);
}

export async function createMode(name: string): Promise<ModeSummary> {
  await requireAdmin();
  const res = await apiFetch<DeviceRow>("/api/devices/scenes", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(res.error.message);
  return toModeSummary(res.data);
}

export async function updateMode(
  deviceId: string,
  name: string,
  targets: Record<string, ModeTargetState>
): Promise<ModeSummary> {
  await requireAdmin();
  const res = await apiFetch<DeviceRow>("/api/devices", {
    method: "POST",
    body: JSON.stringify({ deviceId, type: "scene", name, config: { driver: "scene", targets } }),
  });
  if (!res.ok) throw new Error(res.error.message);
  return toModeSummary(res.data);
}

export async function triggerMode(id: string): Promise<void> {
  await requireAdmin();
  const res = await apiFetch<{ triggered: boolean }>(`/api/devices/scenes/${id}/trigger`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(res.error.message);
}
