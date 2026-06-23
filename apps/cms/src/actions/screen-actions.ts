"use server";

import { revalidatePath } from "next/cache";
import {
  listScreens,
  createScreen,
  deleteScreen,
  setScreenExperience,
  setScreenMedia,
  getScreenContent,
  screenExists,
} from "@platform/db";
import { broadcastWsContentDirect } from "../lib/broadcast";
import { requireAdmin, requireGuestOrAdmin } from "@/lib/auth-helpers";

export async function getScreens() {
  await requireGuestOrAdmin();
  return listScreens();
}

/**
 * Assign an experience to a screen: write the DB (source of truth), then push
 * the derived content to the screen over the WebSocket (event-driven).
 */
export async function assignExperience(screenId: string, experienceId: string) {
  await requireGuestOrAdmin();
  await setScreenExperience(screenId, experienceId);
  const content = await getScreenContent(screenId);
  if (content) await broadcastWsContentDirect(screenId, content);
  revalidatePath("/screens");
  revalidatePath("/");
}

export async function addScreen(screenId: string, screenName: string) {
  await requireAdmin();
  if (await screenExists(screenId)) {
    throw new Error(`Screen ID "${screenId}" already exists.`);
  }
  await createScreen(screenId, screenName);
  revalidatePath("/screens");
  revalidatePath("/");
}

export async function removeScreen(screenId: string) {
  await requireAdmin();
  await deleteScreen(screenId);
  revalidatePath("/screens");
  revalidatePath("/");
}

export async function sendRemoteCommand(screenId: string, command: string, value?: any): Promise<void> {
  await requireGuestOrAdmin();
  const apiUrl = process.env["INTERNAL_API_URL"] || "http://localhost:4000";
  const secret = process.env["BROADCAST_SECRET"] || "dev-secret";

  try {
    await fetch(`${apiUrl}/api/internal/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-broadcast-secret": secret,
      },
      body: JSON.stringify({ screenId, command, value }),
    });
  } catch (err) {
    console.error("[remote] sendRemoteCommand failed for screen", screenId, command, err);
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

/**
 * Assign a media-library asset to a screen. Media is a first-class entity, so we
 * point the screen straight at the media asset (no placeholder experience).
 */
export async function assignMedia(screenId: string, mediaAssetId: string) {
  await requireGuestOrAdmin();
  await setScreenMedia(screenId, mediaAssetId);
  const content = await getScreenContent(screenId);
  if (content) await broadcastWsContentDirect(screenId, content);
  revalidatePath("/screens");
  revalidatePath("/");
}
