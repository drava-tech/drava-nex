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

/** screenId -> whiteboard_document id, for every screen a saved whiteboard is
 * currently being live-pushed to — lets the /screens list's "Control" button
 * redirect straight into that same live session (/whiteboards/<id>/live/<screenId>)
 * instead of the generic per-screen control page. */
export async function getActiveWhiteboardSessions(): Promise<Record<string, string>> {
  await requireGuestOrAdmin();
  const apiUrl = process.env["INTERNAL_API_URL"] || "http://localhost:4000";

  try {
    const res = await fetch(`${apiUrl}/api/screens/active`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      return data.activeWhiteboards ?? {};
    }
  } catch (err) {
    console.error("[remote] getActiveWhiteboardSessions failed", err);
  }
  return {};
}

/** Record (or clear, with null) which saved whiteboard is being live-pushed to a screen. */
export async function setScreenWhiteboardSession(screenId: string, documentId: string | null): Promise<void> {
  await requireGuestOrAdmin();
  const res = await apiFetch(`/api/screens/${encodeURIComponent(screenId)}/whiteboard-session`, {
    method: "POST",
    body: JSON.stringify({ documentId }),
  });
  if (!res.ok) console.error("[remote] setScreenWhiteboardSession failed", res.error);
}

/**
 * Assign a media-library asset to a screen (points the screen straight at the
 * asset), or clear the current assignment with null so it falls back to the
 * screen's default/idle media.
 */
export async function assignMedia(screenId: string, mediaAssetId: string | null) {
  await requireGuestOrAdmin();
  const res = await apiFetch(`/api/screens/${encodeURIComponent(screenId)}/media`, {
    method: "POST",
    body: JSON.stringify({ mediaAssetId }),
  });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/screens");
  revalidatePath("/");
}

/**
 * Push an ordered list of media assets to a screen as a queue — the screen's
 * current item becomes the one at startIndex (default 0). The full list is
 * recorded server-side so advanceScreenQueue (Next/Prev) can step through it
 * later, surviving CMS reloads and staying in sync across multiple open
 * control panels.
 */
export async function assignMediaQueue(screenId: string, mediaAssetIds: string[], startIndex = 0) {
  await requireGuestOrAdmin();
  const res = await apiFetch(`/api/screens/${encodeURIComponent(screenId)}/media-queue`, {
    method: "POST",
    body: JSON.stringify({ mediaAssetIds, startIndex }),
  });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/screens");
  revalidatePath("/");
}

/**
 * Step a screen's active queue forward/back one item. Returns the new 0-based
 * index — the DB stays authoritative; this is only handed back to the caller
 * (LiveControlDialog) to update its local "N of M" display.
 */
export async function advanceScreenQueue(screenId: string, direction: "next" | "prev"): Promise<number> {
  await requireGuestOrAdmin();
  const res = await apiFetch<{ queueIndex: number }>(
    `/api/screens/${encodeURIComponent(screenId)}/queue/navigate`,
    { method: "POST", body: JSON.stringify({ direction }) }
  );
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/screens");
  revalidatePath("/");
  return res.data.queueIndex;
}

/** Set (or clear with null) a screen's default/fallback video, shown when nothing else is assigned. */
export async function assignDefaultMedia(screenId: string, mediaAssetId: string | null) {
  await requireGuestOrAdmin();
  const res = await apiFetch(`/api/screens/${encodeURIComponent(screenId)}/default-media`, {
    method: "POST",
    body: JSON.stringify({ mediaAssetId }),
  });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/screens");
  revalidatePath("/");
}

/** Stop (full-black overlay) or resume a screen. Persists so a reconnect stays black. */
export async function setScreenBlanked(screenId: string, blanked: boolean) {
  await requireGuestOrAdmin();
  const res = await apiFetch(`/api/screens/${encodeURIComponent(screenId)}/blank`, {
    method: "POST",
    body: JSON.stringify({ blanked }),
  });
  if (!res.ok) throw new Error(res.error.message);
  revalidatePath("/screens");
  revalidatePath("/");
}

/** Enable/disable interactivity (click/scroll/type) everywhere this screen is rendered. */
export async function setScreenInteractionEnabled(screenId: string, enabled: boolean) {
  await requireGuestOrAdmin();
  const res = await apiFetch(`/api/screens/${encodeURIComponent(screenId)}/interaction`, {
    method: "POST",
    body: JSON.stringify({ enabled }),
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
