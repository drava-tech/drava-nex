"use server";

import { revalidatePath } from "next/cache";
import {
  listScreens,
  createScreen,
  deleteScreen,
  setScreenExperience,
  getScreenContent,
  screenExists,
  db,
  experience,
  eq,
  and,
  isNull,
} from "@platform/db";
import { broadcastWsContentDirect } from "../lib/broadcast";
import { requireAdmin, requireGuestOrAdmin } from "@/lib/auth-helpers";

export async function getScreens(): Promise<{
  screenId: string;
  screenName: string;
  currentExperienceId: string | null;
  experienceName: string | null;
}[]> {
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

export async function assignMedia(screenId: string, filename: string, type: "video" | "image") {
  await requireGuestOrAdmin();

  const mediaName = `[MEDIA:${type}] ${filename}`;
  // Clean slug: replace non-alphanumeric chars with dashes and lowercase
  const mediaSlug = `media-${type}-${filename.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}`;

  // 1. Find if the placeholder experience already exists
  const [existing] = await db
    .select()
    .from(experience)
    .where(and(eq(experience.name, mediaName), isNull(experience.deletedAt)))
    .limit(1);

  let experienceId: string;
  if (existing) {
    experienceId = existing.id;
  } else {
    // 2. Insert new placeholder experience
    const [inserted] = await db
      .insert(experience)
      .values({
        name: mediaName,
        slug: mediaSlug,
      })
      .returning();
    if (!inserted) {
      throw new Error("Failed to register media asset experience placeholder");
    }
    experienceId = inserted.id;
  }

  // 3. Assign this experience to the screen
  await setScreenExperience(screenId, experienceId);

  // 4. Push the update over WebSocket
  const content = await getScreenContent(screenId);
  if (content) await broadcastWsContentDirect(screenId, content);

  revalidatePath("/screens");
  revalidatePath("/");
}
