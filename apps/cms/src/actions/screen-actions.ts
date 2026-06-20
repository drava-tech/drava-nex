"use server";

import { revalidatePath } from "next/cache";
import {
  listScreens,
  createScreen,
  deleteScreen,
  setScreenExperience,
  getScreenContent,
  screenExists,
} from "@platform/db";
import { broadcastWsContentDirect } from "../lib/broadcast";
import { requireAdmin, requireGuestOrAdmin } from "@/lib/auth-helpers";

export async function getScreens(): Promise<{ screenId: string; screenName: string }[]> {
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
