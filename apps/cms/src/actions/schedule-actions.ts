"use server";

import { revalidatePath } from "next/cache";
import { listSchedules, type ScheduleInput, type ScheduleRow } from "@platform/db";
import { apiFetch } from "@/lib/api-client";
import { requireAdmin, requireGuestOrAdmin } from "@/lib/auth-helpers";

// Reads of the schedules themselves stay direct (DB); what's on air comes from
// the API, whose scheduler is the one running them. Mutations go through the
// API, like every other screen change, so the scheduler re-runs at once.

type Result = { success: true; id?: string } | { success: false; error: string };

function done(res: { ok: boolean; error?: { message: string } }, id?: string): Result {
  if (!res.ok) return { success: false, error: res.error?.message ?? "Something went wrong." };
  revalidatePath("/schedules");
  return { success: true, id };
}

export async function getSchedules(): Promise<ScheduleRow[]> {
  await requireGuestOrAdmin();
  return listSchedules();
}

/** Per screen: the schedule and item on air now, and the next one due. Mirrors apps/api's ScreenScheduleStatus. */
export interface ScreenScheduleStatus {
  screenId: string;
  screenName: string;
  groupId: string | null;
  online: boolean;
  paused: "stopped" | "whiteboard" | null;
  current: {
    scheduleId: string;
    scheduleName: string;
    itemIndex: number;
    itemCount: number;
    kind: "experience" | "media";
    contentId: string;
    changesAt: string;
    itemStartedAt: string;
    windowEndsAt: string;
    manualOverride: boolean;
    overriddenNames: string[];
  } | null;
  next: { scheduleId: string; scheduleName: string; startsAt: string } | null;
}

export async function getScheduleStatus(): Promise<{ now: string; screens: ScreenScheduleStatus[] } | null> {
  await requireGuestOrAdmin();
  const res = await apiFetch<{ now: string; screens: ScreenScheduleStatus[] }>(`/api/schedules/now`, {
    cache: "no-store",
  });
  return res.ok ? res.data : null;
}

export async function createSchedule(input: ScheduleInput): Promise<Result> {
  await requireAdmin();
  const res = await apiFetch<{ id: string }>(`/api/schedules`, { method: "POST", body: JSON.stringify(input) });
  return done(res, res.ok ? res.data?.id : undefined);
}

export async function updateSchedule(id: string, input: ScheduleInput): Promise<Result> {
  await requireAdmin();
  return done(
    await apiFetch(`/api/schedules/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }),
    id
  );
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<Result> {
  await requireAdmin();
  return done(
    await apiFetch(`/api/schedules/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
    id
  );
}

export async function deleteSchedule(id: string): Promise<Result> {
  await requireAdmin();
  return done(await apiFetch(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" }));
}
