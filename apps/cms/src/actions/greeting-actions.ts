"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

/** The slice of GET /api/greeting/status the dashboard badge shows. */
export type GreetingStatusDto =
  | { enabled: false; armed: boolean }
  | {
      enabled: true;
      armed: boolean;
      voice: string;
      voiceName: string | null;
      nameMode: string;
      screen: { id: string; online: boolean };
      today: { date: string; greeted: number; skipped: number; skippedByReason: Record<string, number> };
      lastGreeting: { at: string; text: string | null; names: string[] } | null;
      breaker: { paused: boolean; until: string | null; lastError: string | null };
      lastTvAck: { spoke: boolean; voice?: string; error?: string; at: string } | null;
    };

/** Admin-only; null if the API can't be reached (the badge then just hides itself). */
export async function getGreetingStatus(): Promise<GreetingStatusDto | null> {
  await requireAdmin();
  const res = await apiFetch<GreetingStatusDto>("/api/greeting/status");
  if (!res.ok) {
    console.error("[greeting] getGreetingStatus failed", res.error);
    return null;
  }
  return res.data;
}
