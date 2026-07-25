"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

export interface ModeSummary {
  id: string;
  name: string;
}

interface DeviceRow {
  id: string;
  name: string;
  type: string;
}

export async function listModes(): Promise<ModeSummary[]> {
  await requireAdmin();
  const res = await apiFetch<DeviceRow[]>("/api/devices");
  if (!res.ok) throw new Error(res.error.message);
  return res.data.filter((d) => d.type === "scene").map((d) => ({ id: d.id, name: d.name }));
}

export async function createMode(name: string): Promise<ModeSummary> {
  await requireAdmin();
  const res = await apiFetch<DeviceRow>("/api/devices/scenes", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(res.error.message);
  return { id: res.data.id, name: res.data.name };
}

export async function triggerMode(id: string): Promise<void> {
  await requireAdmin();
  const res = await apiFetch<{ triggered: boolean }>(`/api/devices/scenes/${id}/trigger`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(res.error.message);
}
