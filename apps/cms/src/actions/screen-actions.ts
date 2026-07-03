"use server";

import { revalidatePath } from "next/cache";
import { listScreens } from "@platform/db";
import { apiFetch } from "@/lib/api-client";
import { requireAdmin, requireGuestOrAdmin } from "@/lib/auth-helpers";

// Reads stay direct (Server Components / DB). All mutations go through the Hono
// API so the exact same endpoints serve the browser, Unreal Engine, and mobile.

export async function getScreens() {
  await requireGuestOrAdmin();
  return listScreens();
}

/**
 * Assign an experience to a screen. The API writes the DB (source of truth) and
 * pushes the derived content over WebSocket to the screen + CMS + UE subscribers.
 */
export async function assignExperience(screenId: string, experienceId: string) {
  await requireGuestOrAdmin();
  const res = await apiFetch(`/api/screens/${encodeURIComponent(screenId)}/experience`, {
    method: "POST",
    body: JSON.stringify({ experienceId }),
  });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/screens");
  revalidatePath("/");
}

export async function addScreen(screenId: string, screenName: string) {
  await requireAdmin();
  const res = await apiFetch(`/api/screens`, {
    method: "POST",
    body: JSON.stringify({ screenId, screenName }),
  });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/screens");
  revalidatePath("/");
}

export async function removeScreen(screenId: string) {
  await requireAdmin();
  const res = await apiFetch(`/api/screens/${encodeURIComponent(screenId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/screens");
  revalidatePath("/");
}

export async function sendRemoteCommand(screenId: string, command: string, value?: any): Promise<void> {
  await requireGuestOrAdmin();
  const res = await apiFetch(`/api/screens/${encodeURIComponent(screenId)}/command`, {
    method: "POST",
    body: JSON.stringify({ command, value }),
  });
  if (!res.ok) {
    console.error("[remote] sendRemoteCommand failed for screen", screenId, command, res.error);
  }
}

export async function getActiveScreens(): Promise<string[]> {
  await requireGuestOrAdmin();
  const apiUrl = process.env["INTERNAL_API_URL"] || "http://localhost:4000";

  try {
    const res = await fetch(`${apiUrl}/api/screens/active`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      return data.activeScreenIds ?? [];
    }
  } catch (err) {
    console.error("[remote] getActiveScreens failed", err);
  }
  return [];
}

/** Assign a media-library asset to a screen (points the screen straight at the asset). */
export async function assignMedia(screenId: string, mediaAssetId: string) {
  await requireGuestOrAdmin();
  const res = await apiFetch(`/api/screens/${encodeURIComponent(screenId)}/media`, {
    method: "POST",
    body: JSON.stringify({ mediaAssetId }),
  });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/screens");
  revalidatePath("/");
}

export async function resetDetection(screenId: string) {
  await requireAdmin();
  const res = await apiFetch(`/api/screens/${encodeURIComponent(screenId)}/reset-detection`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/screens");
  revalidatePath("/");
}
