"use server";

import { revalidatePath } from "next/cache";
import type { MotionTriggerInput, MotionTriggerRow } from "@platform/db";
import { apiFetch } from "@/lib/api-client";
import { requireAdmin } from "@/lib/auth-helpers";

// Motion triggers live in the API (it hears the sensors and runs the
// scheduler), so reads and changes both go through it.

export interface MotionTriggerStatus {
  playingUntil: string | null;
  lastFiredAt: string | null;
  readyAt: string | null;
}

export interface MotionOverview {
  triggers: MotionTriggerRow[];
  status: Record<string, MotionTriggerStatus>;
  /** Whether the API is connected to Home Assistant (its sensors can fire triggers). */
  homeAssistant: boolean;
  /** Whether sensors may call POST /api/motion-triggers/fire (MOTION_TRIGGER_TOKEN is set). */
  sensorCalls: boolean;
}

type Result = { success: true } | { success: false; error: string };

function done(res: { ok: boolean; error?: { message: string } }): Result {
  if (!res.ok) return { success: false, error: res.error?.message ?? "Something went wrong." };
  revalidatePath("/schedules");
  return { success: true };
}

/** null when the API couldn't answer (e.g. its database isn't set up for motion triggers yet). */
export async function getMotionOverview(): Promise<MotionOverview | null> {
  await requireAdmin();
  const res = await apiFetch<MotionOverview>(`/api/motion-triggers`, { cache: "no-store" });
  return res.ok ? res.data : null;
}

export async function getMotionSensors(): Promise<{ available: boolean; sensors: { id: string; name: string; state: string }[] }> {
  await requireAdmin();
  const res = await apiFetch<{ available: boolean; sensors: { id: string; name: string; state: string }[] }>(
    `/api/motion-triggers/sensors`,
    { cache: "no-store" }
  );
  return res.ok ? res.data : { available: false, sensors: [] };
}

export async function createMotionTrigger(input: MotionTriggerInput): Promise<Result> {
  await requireAdmin();
  return done(await apiFetch(`/api/motion-triggers`, { method: "POST", body: JSON.stringify(input) }));
}

export async function updateMotionTrigger(id: string, input: MotionTriggerInput): Promise<Result> {
  await requireAdmin();
  return done(await apiFetch(`/api/motion-triggers/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }));
}

export async function deleteMotionTrigger(id: string): Promise<Result> {
  await requireAdmin();
  return done(await apiFetch(`/api/motion-triggers/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

/** Play it now, ignoring its hours and cooldown. */
export async function testMotionTrigger(id: string): Promise<Result> {
  await requireAdmin();
  return done(await apiFetch(`/api/motion-triggers/${encodeURIComponent(id)}/test`, { method: "POST" }));
}
