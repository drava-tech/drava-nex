import { eq, and, isNull, asc, desc } from "drizzle-orm";
import type { WsContent } from "@platform/types";
import { db } from "../client.js";
import { screen } from "../schema/screens.js";
import { experience } from "../schema/projects.js";

/**
 * Screen ↔ experience data access. This is the single source of truth for
 * "what is playing on which screen" (replaces the old screens.json files).
 */

export async function listScreens(): Promise<{ screenId: string; screenName: string }[]> {
  return db
    .select({ screenId: screen.screenId, screenName: screen.screenName })
    .from(screen)
    .where(isNull(screen.deletedAt))
    .orderBy(asc(screen.position), desc(screen.createdAt));
}

/**
 * Resolve the WsContent currently assigned to a screen, or null when nothing is
 * assigned (or the assigned experience was deleted). Joins the experience and
 * derives the wire shape the screens render.
 */
export async function getScreenContent(screenId: string): Promise<WsContent | null> {
  const [row] = await db
    .select({ experienceId: experience.id, experienceName: experience.name })
    .from(screen)
    .leftJoin(
      experience,
      and(eq(screen.currentExperienceId, experience.id), isNull(experience.deletedAt))
    )
    .where(and(eq(screen.screenId, screenId), isNull(screen.deletedAt)))
    .limit(1);

  if (!row || !row.experienceId) return null;

  return {
    id: row.experienceId,
    type: "experience",
    source: "",
    title: row.experienceName ?? undefined,
  };
}

export async function screenExists(screenId: string): Promise<boolean> {
  const [row] = await db
    .select({ screenId: screen.screenId })
    .from(screen)
    .where(and(eq(screen.screenId, screenId), isNull(screen.deletedAt)))
    .limit(1);
  return Boolean(row);
}

/** Insert a screen, or revive a previously soft-deleted one with the same id. */
export async function createScreen(screenId: string, screenName: string): Promise<void> {
  await db
    .insert(screen)
    .values({ screenId, screenName })
    .onConflictDoUpdate({
      target: screen.screenId,
      set: { screenName, deletedAt: null, updatedAt: new Date() },
    });
}

export async function deleteScreen(screenId: string): Promise<void> {
  await db
    .update(screen)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(screen.screenId, screenId));
}

export async function setScreenExperience(
  screenId: string,
  experienceId: string | null
): Promise<void> {
  await db
    .update(screen)
    .set({ currentExperienceId: experienceId, updatedAt: new Date() })
    .where(eq(screen.screenId, screenId));
}
