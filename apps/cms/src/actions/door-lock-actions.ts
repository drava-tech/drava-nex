"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

export async function toggleDoorLock(action: "locked" | "unlocked") {
  await requireAdmin();
  const res = await apiFetch<{ success: boolean }>(
    "/api/door-events/toggle",
    {
      method: "POST",
      body: JSON.stringify({ action }),
    }
  );
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/door-lock");
  return res.data;
}

export interface LiveLockState {
  state: "locked" | "unlocked";
  changedBy: string | null;
  lastChanged: string;
}

/** Live state read straight from Home Assistant — never from our own
 * recorded event history, which can go stale (e.g. the lock auto-locks). */
export async function getLiveLockState(): Promise<LiveLockState> {
  await requireAdmin();
  const res = await apiFetch<LiveLockState>("/api/door-events/state");
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}
