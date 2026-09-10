import { eq, desc, and, isNull } from "drizzle-orm";
import { db } from "../client.js";
import { screenContentPush } from "../schema/screen-content-pushes.js";
import { mediaAsset } from "../schema/media.js";
import { experience } from "../schema/projects.js";

export interface RecentScreenContentItem {
  id: string;
  kind: "media" | "experience";
  /** Media type ("image"/"video"/...) for a media item; "experience" for an experience. */
  type: string;
  name: string;
  /** Playable/thumbnail URL — null for an experience (no direct asset URL). */
  url: string | null;
  sizeBytes: number | null;
  pushedAt: Date;
}

/**
 * Record a media asset being pushed to a screen — called from
 * setScreenMedia/setScreenMediaQueue in queries/screens.ts for every
 * non-null assignment, single or queued. Append-only: never updated/deleted
 * except via the FK cascade if the screen or media asset itself is deleted.
 */
export async function recordScreenMediaPush(screenId: string, mediaAssetId: string): Promise<void> {
  await db.insert(screenContentPush).values({ screenId, contentKind: "media", mediaAssetId });
}

/** Same as recordScreenMediaPush, for an experience assignment — called from setScreenExperience. */
export async function recordScreenExperiencePush(screenId: string, experienceId: string): Promise<void> {
  await db.insert(screenContentPush).values({ screenId, contentKind: "experience", experienceId });
}

/**
 * Clear all recorded push history for a screen — called when a screen has a
 * fresh launch/restart (kiosk restart).
 */
export async function clearRecentContentForScreen(screenId: string): Promise<void> {
  await db.delete(screenContentPush).where(eq(screenContentPush.screenId, screenId));
}

/**
 * How many raw push rows to read per requested result. The query dedupes in JS,
 * so the newest rows may all be repeats of the same item; this leaves room for
 * that without reading the whole table. If a screen has fewer than `limit`
 * distinct items in its most recent `limit * DEDUPE_HEADROOM` pushes, the tab
 * shows fewer rows — an acceptable trade for a bounded read on a table that
 * grows forever.
 */
const DEDUPE_HEADROOM = 8;

/**
 * Most recent distinct pieces of content (media or experience) pushed to a
 * screen, newest first, capped at `limit` — backs the "Recently Opened" tab
 * in ScreenAssignmentPicker. Deduped so the same item pushed more than once
 * only shows its most recent occurrence.
 */
export async function getRecentContentForScreen(screenId: string, limit = 5): Promise<RecentScreenContentItem[]> {
  const rows = await db
    .select({
      contentKind: screenContentPush.contentKind,
      mediaAssetId: screenContentPush.mediaAssetId,
      experienceId: screenContentPush.experienceId,
      pushedAt: screenContentPush.pushedAt,
      mediaName: mediaAsset.name,
      mediaUrl: mediaAsset.url,
      mediaType: mediaAsset.type,
      mediaSizeBytes: mediaAsset.sizeBytes,
      experienceName: experience.name,
    })
    .from(screenContentPush)
    .leftJoin(mediaAsset, and(eq(screenContentPush.mediaAssetId, mediaAsset.id), isNull(mediaAsset.deletedAt)))
    .leftJoin(experience, and(eq(screenContentPush.experienceId, experience.id), isNull(experience.deletedAt)))
    .where(eq(screenContentPush.screenId, screenId))
    .orderBy(desc(screenContentPush.pushedAt))
    // screen_content_push is append-only (see the table's docblock) and gains a
    // row on every publish, including every queue next/prev step — so a busy
    // screen accumulates thousands. Without a bound this read pulled ALL of
    // them, hydrated through two joins, just to hand back `limit` rows after a
    // JS dedupe. The multiplier covers the dedupe: the newest N rows can be
    // repeats of the same few items, and this is the CMS's most-opened panel.
    .limit(limit * DEDUPE_HEADROOM);

  const seen = new Set<string>();
  const deduped: RecentScreenContentItem[] = [];
  for (const row of rows) {
    if (row.contentKind === "media") {
      // mediaAssetId/mediaName null means the join missed — asset deleted since.
      if (!row.mediaAssetId || !row.mediaName) continue;
      const key = `media:${row.mediaAssetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({
        id: row.mediaAssetId,
        kind: "media",
        type: row.mediaType ?? "",
        name: row.mediaName,
        url: row.mediaUrl,
        sizeBytes: row.mediaSizeBytes,
        pushedAt: row.pushedAt,
      });
    } else {
      if (!row.experienceId || !row.experienceName) continue;
      const key = `experience:${row.experienceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({
        id: row.experienceId,
        kind: "experience",
        type: "experience",
        name: row.experienceName,
        url: null,
        sizeBytes: null,
        pushedAt: row.pushedAt,
      });
    }
    if (deduped.length >= limit) break;
  }
  return deduped;
}
