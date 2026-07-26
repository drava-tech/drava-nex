import { eq, and, isNull, asc, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { mediaAssetToWsContent, type WsContent } from "@platform/types";
import { db } from "../client.js";
import { screen } from "../schema/screens.js";
import { experience } from "../schema/projects.js";
import { mediaAsset } from "../schema/media.js";

/**
 * Screen ↔ content data access. This is the single source of truth for
 * "what is playing on which screen". A screen points at either an experience or
 * a media asset, chosen by `currentContentKind` (the typed refs are mutually
 * exclusive).
 */

export async function listScreens(): Promise<{
  screenId: string;
  screenName: string;
  currentContentKind: string | null;
  currentExperienceId: string | null;
  experienceName: string | null;
  currentMediaAssetId: string | null;
  mediaType: string | null;
  mediaUrl: string | null;
  mediaName: string | null;
  defaultMediaAssetId: string | null;
  defaultMediaName: string | null;
}[]> {
  const defaultMedia = alias(mediaAsset, "default_media");
  return db
    .select({
      screenId: screen.screenId,
      screenName: screen.screenName,
      currentContentKind: screen.currentContentKind,
      currentExperienceId: screen.currentExperienceId,
      experienceName: experience.name,
      currentMediaAssetId: screen.currentMediaAssetId,
      mediaType: mediaAsset.type,
      mediaUrl: mediaAsset.url,
      mediaName: mediaAsset.name,
      defaultMediaAssetId: screen.defaultMediaAssetId,
      defaultMediaName: defaultMedia.name,
    })
    .from(screen)
    .leftJoin(
      experience,
      and(eq(screen.currentExperienceId, experience.id), isNull(experience.deletedAt))
    )
    .leftJoin(
      mediaAsset,
      and(eq(screen.currentMediaAssetId, mediaAsset.id), isNull(mediaAsset.deletedAt))
    )
    .leftJoin(
      defaultMedia,
      and(eq(screen.defaultMediaAssetId, defaultMedia.id), isNull(defaultMedia.deletedAt))
    )
    .where(isNull(screen.deletedAt))
    .orderBy(asc(screen.position), desc(screen.createdAt));
}

/**
 * Resolve the WsContent currently assigned to a screen, or null when nothing is
 * assigned (or the referenced content was deleted). Resolves by the screen's
 * content kind: a media asset → a video/image, an experience → its template.
 * Falls back to the screen's default media (if set) when there is no active
 * assignment — this is also what a camera-detection takeover reverts to once
 * it ends (see resetScreenTakeover in the API's WS gateway).
 */
export async function getScreenContent(screenId: string): Promise<WsContent | null> {
  const [row] = await db
    .select({
      kind: screen.currentContentKind,
      defaultMediaAssetId: screen.defaultMediaAssetId,
      experienceId: experience.id,
      experienceName: experience.name,
      templateKey: experience.templateKey,
      templateContent: experience.templateContent,
      mediaAssetId: mediaAsset.id,
      mediaType: mediaAsset.type,
      mediaUrl: mediaAsset.url,
      mediaName: mediaAsset.name,
    })
    .from(screen)
    .leftJoin(
      experience,
      and(eq(screen.currentExperienceId, experience.id), isNull(experience.deletedAt))
    )
    .leftJoin(
      mediaAsset,
      and(eq(screen.currentMediaAssetId, mediaAsset.id), isNull(mediaAsset.deletedAt))
    )
    .where(and(eq(screen.screenId, screenId), isNull(screen.deletedAt)))
    .limit(1);

  if (!row) return null;

  // Media asset assigned → wire content for its kind (video/image natively,
  // PDF/sheet/YouTube/Drive as an embedded page — see mediaAssetToWsContent).
  if (row.kind === "media" && row.mediaAssetId) {
    return mediaAssetToWsContent({
      id: row.mediaAssetId,
      type: row.mediaType ?? "",
      url: row.mediaUrl ?? "",
      name: row.mediaName,
    });
  }

  // Experience assigned → template wire content.
  if (row.kind === "experience" && row.experienceId) {
    return {
      id: row.experienceId,
      type: "experience",
      source: "",
      title: row.experienceName ?? undefined,
      templateKey: row.templateKey ?? undefined,
      templateContent: row.templateContent ?? undefined,
    };
  }

  // Nothing active (or the active reference was deleted) — fall back to the
  // screen's default video/image, if one is set.
  if (row.defaultMediaAssetId) {
    const [defaultMedia] = await db
      .select({
        id: mediaAsset.id,
        type: mediaAsset.type,
        url: mediaAsset.url,
        name: mediaAsset.name,
      })
      .from(mediaAsset)
      .where(and(eq(mediaAsset.id, row.defaultMediaAssetId), isNull(mediaAsset.deletedAt)))
      .limit(1);

    if (defaultMedia) {
      return mediaAssetToWsContent(defaultMedia, { loop: true, muted: true });
    }
  }

  return null;
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

/** Assign an experience (or clear with null). Clears any media assignment. */
export async function setScreenExperience(
  screenId: string,
  experienceId: string | null
): Promise<void> {
  await db
    .update(screen)
    .set({
      currentContentKind: experienceId ? "experience" : null,
      currentExperienceId: experienceId,
      currentMediaAssetId: null,
      updatedAt: new Date(),
    })
    .where(eq(screen.screenId, screenId));
}

/** Assign a media asset (or clear with null). Clears any experience assignment. */
export async function setScreenMedia(
  screenId: string,
  mediaAssetId: string | null
): Promise<void> {
  await db
    .update(screen)
    .set({
      currentContentKind: mediaAssetId ? "media" : null,
      currentMediaAssetId: mediaAssetId,
      currentExperienceId: null,
      updatedAt: new Date(),
    })
    .where(eq(screen.screenId, screenId));
}

/**
 * Set (or clear with null) a screen's default/fallback media asset. Does not
 * touch the current assignment — this only affects what getScreenContent
 * falls back to when nothing else is active.
 */
export async function setScreenDefaultMedia(
  screenId: string,
  mediaAssetId: string | null
): Promise<void> {
  await db
    .update(screen)
    .set({ defaultMediaAssetId: mediaAssetId, updatedAt: new Date() })
    .where(eq(screen.screenId, screenId));
}

/**
 * True if the screen is currently showing its default/idle video — either no
 * active assignment at all (kind is null, falls back to defaultMediaAssetId),
 * or the current assignment happens to already be that same default media.
 * Used to decide whether an unlock event should take over the screen (only
 * when idle) without interrupting real assigned content.
 */
export async function isScreenIdle(screenId: string): Promise<boolean> {
  const [row] = await db
    .select({
      kind: screen.currentContentKind,
      currentMediaAssetId: screen.currentMediaAssetId,
      defaultMediaAssetId: screen.defaultMediaAssetId,
    })
    .from(screen)
    .where(eq(screen.screenId, screenId))
    .limit(1);
  if (!row) return false;
  if (row.kind === null) return true;
  return (
    row.kind === "media" &&
    row.defaultMediaAssetId !== null &&
    row.currentMediaAssetId === row.defaultMediaAssetId
  );
}
