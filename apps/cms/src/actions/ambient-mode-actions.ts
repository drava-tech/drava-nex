"use server";

import { requireAdmin, requireGuestOrAdmin } from "@/lib/auth-helpers";
import { apiFetch } from "@/lib/api-client";

export interface AmbientModeSummary {
  key: string;
  label: string;
  /** "#RRGGBB". The warm-white value means the fixtures' own white LEDs. */
  color: string;
  /** 0-100. */
  brightness: number;
  /** false = the strip light is switched off in this mode. */
  stripOn: boolean;
}

/** The whole-room lighting modes (pre-entry, entry, meeting, presentation), in display order. */
export async function listAmbientModes(): Promise<AmbientModeSummary[]> {
  await requireGuestOrAdmin();
  const res = await apiFetch<AmbientModeSummary[]>("/api/ambient-modes", { method: "GET" });
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}

/** Change what a mode does. Does not apply it to the room. */
export async function saveAmbientMode(
  key: string,
  patch: { color?: string; brightness?: number; stripOn?: boolean },
): Promise<AmbientModeSummary> {
  await requireAdmin();
  const res = await apiFetch<AmbientModeSummary>(`/api/ambient-modes/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}

/** Put the room's lights into a mode. Reports how many lights took it. */
export async function applyAmbientMode(key: string): Promise<{ key: string; applied: number; failed: number }> {
  await requireGuestOrAdmin();
  const res = await apiFetch<{ key: string; applied: number; failed: number }>(
    `/api/ambient-modes/${encodeURIComponent(key)}/apply`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}
