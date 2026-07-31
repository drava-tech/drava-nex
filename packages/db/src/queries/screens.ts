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
  blanked: boolean;
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
      blanked: screen.blanked,
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

/**
 * All screens currently assigned an experience with the given templateKey —
 * i.e. whichever screen(s) an admin picked via "Push to screen" in the CMS.
 * Used by live-detection takeover routing (the mat camera's object-recognition
 * feed) so the destination screen is chosen in the CMS UI rather than fixed to
 * one screen by a camera-id env mapping.
 */
export async function getScreenIdsByTemplateKey(templateKey: string): Promise<string[]> {
  const rows = await db
    .select({ screenId: screen.screenId })
    .from(screen)
    .innerJoin(
      experience,
      and(eq(screen.currentExperienceId, experience.id), isNull(experience.deletedAt))
    )
    .where(
      and(
        eq(screen.currentContentKind, "experience"),
        eq(experience.templateKey, templateKey),
        isNull(screen.deletedAt)
      )
    );
  return rows.map((r) => r.screenId);
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
 * Record (or clear, with null) the live whiteboard state for a screen — an
 * overlay on top of whatever content is assigned, so a display-page refresh
 * mid-session can resume it instead of falling back to the assigned content.
 * See apps/api/src/ws/gateway.ts, which calls this on "settling" whiteboard
 * commands (not the high-frequency stroke-point events).
 */
export async function setScreenWhiteboardState(
  screenId: string,
  state: unknown | null
): Promise<void> {
  await db
    .update(screen)
    .set({
      whiteboardActive: state !== null,
      whiteboardState: state,
      updatedAt: new Date(),
    })
    .where(eq(screen.screenId, screenId));
}

export async function getScreenWhiteboardState(
  screenId: string
): Promise<{ active: boolean; state: unknown } | null> {
  const [row] = await db
    .select({ whiteboardActive: screen.whiteboardActive, whiteboardState: screen.whiteboardState })
    .from(screen)
    .where(and(eq(screen.screenId, screenId), isNull(screen.deletedAt)))
    .limit(1);
  if (!row) return null;
  return { active: row.whiteboardActive, state: row.whiteboardState };
}

/** Set (or clear) the full-black overlay for a screen — see `screen.blanked`. */
export async function setScreenBlanked(screenId: string, blanked: boolean): Promise<void> {
  await db
    .update(screen)
    .set({ blanked, updatedAt: new Date() })
    .where(eq(screen.screenId, screenId));
}

export async function getScreenBlanked(screenId: string): Promise<boolean> {
  const [row] = await db
    .select({ blanked: screen.blanked })
    .from(screen)
    .where(and(eq(screen.screenId, screenId), isNull(screen.deletedAt)))
    .limit(1);
  return row?.blanked ?? false;
}

/** Enable/disable click/scroll/type everywhere this screen renders — see `screen.interactionEnabled`. */
export async function setScreenInteractionEnabled(screenId: string, enabled: boolean): Promise<void> {
  await db
    .update(screen)
    .set({ interactionEnabled: enabled, updatedAt: new Date() })
    .where(eq(screen.screenId, screenId));
}

export async function getScreenInteractionEnabled(screenId: string): Promise<boolean> {
  const [row] = await db
    .select({ interactionEnabled: screen.interactionEnabled })
    .from(screen)
    .where(and(eq(screen.screenId, screenId), isNull(screen.deletedAt)))
    .limit(1);
  return row?.interactionEnabled ?? true;
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
