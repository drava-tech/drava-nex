import { eq, and, or, isNull, desc, ilike, inArray, gte, lt, count, sql, type SQL } from "drizzle-orm";
import { db } from "../client.js";
import { mediaAsset, type MediaAsset } from "../schema/media.js";
import type { MediaCursor, MediaFilter } from "@platform/types";

/**
 * Media library listing.
 *
 * Every listing is (deleted_at IS NULL AND pending_save = false) ordered
 * created_at DESC — pending-save rows are ad-hoc Browser-tool pushes not yet
 * confirmed as worth keeping; they stay fully playable/assignable, just unlisted.
 *
 * Two paging modes, both served from media_asset_listing_idx:
 *   listMediaAssets       OFFSET — for /media's numbered pages (needs a total)
 *   listMediaAssetsCursor KEYSET — for /broadcast's append-scroll carousel
 *
 * The carousel needs keyset specifically because rows are constantly inserted
 * at the HEAD of this ordering (Gmail ingest, MEDIA_LIBRARY_UPDATED). With
 * OFFSET, each such insert shifts the window and the following page repeats or
 * skips cards mid-scroll; a cursor is anchored to a row, so inserts above it
 * simply aren't part of the walk.
 */

/**
 * Cursors are opaque on the wire so no caller is tempted to synthesise one — a
 * hand-built cursor that disagrees with the sort order silently skips rows
 * instead of erroring. Encoded here rather than in @platform/types because
 * that package is part of the browser bundle and this is server-only.
 */
export function encodeMediaCursor(cursor: MediaCursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString("base64url");
}

/** Returns null for anything unparseable — a bad cursor restarts the walk from
 *  the top rather than 500ing a carousel mid-scroll. */
export function decodeMediaCursor(raw: string | undefined): MediaCursor | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const sep = decoded.lastIndexOf("|");
    if (sep <= 0) return null;
    const createdAt = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** Explicit list rather than select() so a future large column (a blob, an
 *  extracted-text field) can't silently join every listing payload — same
 *  reasoning as visitorColumns keeping imageBytes out of visitor lists. */
const mediaColumns = {
  id: mediaAsset.id,
  type: mediaAsset.type,
  url: mediaAsset.url,
  name: mediaAsset.name,
  sizeBytes: mediaAsset.sizeBytes,
  uploadedByUserId: mediaAsset.uploadedByUserId,
  source: mediaAsset.source,
  emailFrom: mediaAsset.emailFrom,
  emailSubject: mediaAsset.emailSubject,
  pendingSave: mediaAsset.pendingSave,
  thumbnailUrl: mediaAsset.thumbnailUrl,
  createdAt: mediaAsset.createdAt,
  updatedAt: mediaAsset.updatedAt,
  deletedAt: mediaAsset.deletedAt,
};

export type MediaListRow = MediaAsset;

export interface MediaListResult {
  items: MediaListRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MediaCursorResult {
  items: MediaListRow[];
  /** null once the walk has reached the end of the list. */
  nextCursor: string | null;
}

/**
 * The filter half of the WHERE, shared by both modes so they can never drift.
 *
 * dateFrom/dateTo are "YYYY-MM-DD" and bound the UTC day, matching what the
 * old client-side filter did when it compared `createdAt.slice(0, 10)`. Kept as
 * range predicates on the bare column (rather than a date-cast) so the index
 * still applies — casting created_at here would make it unsargable.
 */
function mediaWhere(filter: Partial<MediaFilter> = {}): SQL | undefined {
  const conditions: (SQL | undefined)[] = [
    isNull(mediaAsset.deletedAt),
    eq(mediaAsset.pendingSave, false),
  ];

  if (filter.search) {
    conditions.push(ilike(mediaAsset.name, `%${filter.search}%`));
  }
  if (filter.types?.length) {
    conditions.push(inArray(mediaAsset.type, filter.types));
  }
  if (filter.sources?.length) {
    // source is nullable, and a null source is 'upload' by convention for rows
    // predating the source column — include those when 'upload' is asked for.
    const inList = inArray(mediaAsset.source, filter.sources);
    conditions.push(
      filter.sources.includes("upload")
        ? or(inList, isNull(mediaAsset.source))
        : inList
    );
  }
  if (filter.dateFrom) {
    conditions.push(gte(mediaAsset.createdAt, new Date(`${filter.dateFrom}T00:00:00.000Z`)));
  }
  if (filter.dateTo) {
    // Exclusive upper bound at the start of the next UTC day, so the whole of
    // dateTo is included without needing a date cast.
    const next = new Date(`${filter.dateTo}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    conditions.push(lt(mediaAsset.createdAt, next));
  }

  return and(...conditions);
}

/** Offset paging — backs /media's numbered pages, so it pays for a COUNT. */
export async function listMediaAssets(
  query: Partial<MediaFilter> & { page?: number; pageSize?: number } = {}
): Promise<MediaListResult> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
  const where = mediaWhere(query);

  const totalRows = await db.select({ total: count() }).from(mediaAsset).where(where);
  const total = totalRows[0]?.total ?? 0;

  const items = await db
    .select(mediaColumns)
    .from(mediaAsset)
    .where(where)
    .orderBy(desc(mediaAsset.createdAt), desc(mediaAsset.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items, total, page, pageSize };
}

/**
 * Keyset paging — backs /broadcast's carousel. No COUNT (the carousel has no
 * page numbers to render one into) and no OFFSET, so cost stays flat however
 * deep the scroll goes.
 *
 * The (created_at, id) row-value comparison is what makes this correct: a bulk
 * Gmail ingest writes many rows sharing a created_at to the millisecond, and a
 * cursor comparing created_at alone would skip whichever of them straddled the
 * page boundary. Ordering by both, and seeking on both as a tuple, is the only
 * form that can't lose a row.
 */
export async function listMediaAssetsCursor(
  query: Partial<MediaFilter> & { cursor?: string; limit?: number } = {}
): Promise<MediaCursorResult> {
  const limit = Math.min(100, Math.max(1, query.limit ?? 30));
  const cursor: MediaCursor | null = decodeMediaCursor(query.cursor);

  const conditions: (SQL | undefined)[] = [mediaWhere(query)];
  if (cursor) {
    conditions.push(
      sql`(${mediaAsset.createdAt}, ${mediaAsset.id}) < (${new Date(cursor.createdAt)}, ${cursor.id})`
    );
  }

  // One extra row is a cheaper "is there more?" than a second COUNT query.
  const rows = await db
    .select(mediaColumns)
    .from(mediaAsset)
    .where(and(...conditions))
    .orderBy(desc(mediaAsset.createdAt), desc(mediaAsset.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeMediaCursor({ createdAt: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}

/** Per-type rollup + the newest few rows — everything the dashboard's media
 *  widgets need, without shipping the library to the browser to reduce it there. */
export interface MediaLibraryStats {
  total: number;
  totalBytes: number;
  /** One entry per distinct media_asset.type present in the library. */
  byType: { type: string; count: number; bytes: number }[];
  /** Assets created in the last 7 days. */
  recentCount: number;
  /** The newest few assets, for the "recent uploads" list. */
  recent: {
    id: string;
    name: string;
    type: string;
    sizeBytes: number | null;
    createdAt: Date;
  }[];
}

/**
 * Aggregates over the whole (optionally filtered) library.
 *
 * Two callers, one shape:
 *  - the dashboard cards want unfiltered totals — count, bytes stored, type
 *    ratio — which a page of rows cannot produce, and which fetching every row
 *    to sum in the browser is what this replaces;
 *  - the /broadcast carousel passes its own source/date filter and reads
 *    `byType` as a facet list, so its "media type" dropdown can offer exactly
 *    the types that actually exist under the current filter. Under cursor
 *    paging the client has only seen the pages it has scrolled through, so the
 *    facets have to come from the server or the dropdown goes stale.
 *
 * COUNT/SUM/GROUP BY return a handful of rows however large the library grows.
 */
export async function getMediaLibraryStats(
  filter: Partial<MediaFilter> = {},
  recentLimit = 4
): Promise<MediaLibraryStats> {
  const where = mediaWhere(filter);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [grouped, recentRows, recentCountRows] = await Promise.all([
    db
      .select({
        type: mediaAsset.type,
        count: count(),
        bytes: sql<number>`coalesce(sum(${mediaAsset.sizeBytes}), 0)::bigint`,
      })
      .from(mediaAsset)
      .where(where)
      .groupBy(mediaAsset.type),
    db
      .select({
        id: mediaAsset.id,
        name: mediaAsset.name,
        type: mediaAsset.type,
        sizeBytes: mediaAsset.sizeBytes,
        createdAt: mediaAsset.createdAt,
      })
      .from(mediaAsset)
      .where(where)
      .orderBy(desc(mediaAsset.createdAt), desc(mediaAsset.id))
      .limit(recentLimit),
    db
      .select({ total: count() })
      .from(mediaAsset)
      .where(and(where, gte(mediaAsset.createdAt, weekAgo))),
  ]);

  // sum() comes back as a string from pg for bigint — coerce before adding.
  const byType = grouped.map((g) => ({
    type: g.type,
    count: Number(g.count),
    bytes: Number(g.bytes ?? 0),
  }));

  return {
    total: byType.reduce((sum, g) => sum + g.count, 0),
    totalBytes: byType.reduce((sum, g) => sum + g.bytes, 0),
    byType,
    recentCount: recentCountRows[0]?.total ?? 0,
    recent: recentRows,
  };
}

export async function getMediaAsset(id: string): Promise<MediaAsset | null> {
  const [row] = await db
    .select()
    .from(mediaAsset)
    .where(and(eq(mediaAsset.id, id), isNull(mediaAsset.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function createMediaAsset(values: {
  type: string;
  url: string;
  name: string;
  sizeBytes?: number | null;
  uploadedByUserId?: string | null;
  source?: string | null;
  emailFrom?: string | null;
  emailSubject?: string | null;
  pendingSave?: boolean;
  thumbnailUrl?: string | null;
}): Promise<MediaAsset> {
  const [row] = await db.insert(mediaAsset).values(values).returning();
  if (!row) throw new Error("Failed to create media asset");
  return row;
}

/** Attach (or clear) an asset's derived thumbnail. Used by the upload path and
 *  by the backfill script; separate from createMediaAsset because generation is
 *  best-effort and must never block or fail the upload itself. */
export async function setMediaThumbnail(id: string, thumbnailUrl: string | null): Promise<void> {
  await db
    .update(mediaAsset)
    .set({ thumbnailUrl, updatedAt: new Date() })
    .where(eq(mediaAsset.id, id));
}

/** Image assets still missing a thumbnail — drives the backfill. */
export async function listMediaMissingThumbnails(limit = 500): Promise<MediaAsset[]> {
  return db
    .select()
    .from(mediaAsset)
    .where(and(isNull(mediaAsset.deletedAt), eq(mediaAsset.type, "image"), isNull(mediaAsset.thumbnailUrl)))
    .orderBy(desc(mediaAsset.createdAt))
    .limit(limit);
}

export async function softDeleteMediaAsset(id: string): Promise<void> {
  await db
    .update(mediaAsset)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(mediaAsset.id, id));
}

/** Confirms an ad-hoc pushed link is worth keeping — makes it show up in the Media Library from now on. */
export async function markMediaSaved(id: string): Promise<void> {
  await db
    .update(mediaAsset)
    .set({ pendingSave: false, updatedAt: new Date() })
    .where(eq(mediaAsset.id, id));
}
