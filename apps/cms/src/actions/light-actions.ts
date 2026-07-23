"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

export interface LightStateInput {
  on: boolean;
  brightness?: number;
  color?: string;
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
