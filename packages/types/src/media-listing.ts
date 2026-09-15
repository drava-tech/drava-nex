// Media library listing contract — the query shape every media list shares.
//
// Two surfaces page through media_asset and they want different mechanics:
//
//   /media      numbered pages + a 10/25/50/100 size selector  → OFFSET (needs a total)
//   /broadcast  an append-scroll coverflow carousel            → CURSOR (keyset)
//
// The carousel must be keyset rather than offset because new rows land at the
// HEAD of the created_at DESC ordering all the time (Gmail ingest, and any
// MEDIA_LIBRARY_UPDATED push). Under offset, every such insert shifts the
// window and the next page repeats or skips cards mid-scroll. A keyset cursor
// is anchored to a row, so inserts above it are simply invisible to the walk.
//
// Both modes share one filter set, defined once here so the CMS controls, the
// API validation and the SQL can never drift apart.

import { z } from "zod";
import { MEDIA_TYPES } from "./media-content.js";

/**
 * The Media Library's category chips, expanded to the media_asset.type values
 * each one covers. Selecting several categories is an OR (the union of their
 * types), which is why this resolves to a flat type list rather than a
 * per-category predicate: the server only ever needs `type IN (...)`.
 *
 * 'documents' deliberately covers both 'document' (PDF) and 'word' (.docx),
 * and 'links' covers the pasted-URL kinds — matching matchesCategory() in the
 * media page this replaced.
 */
export const MEDIA_CATEGORY_TYPES: Record<string, readonly string[]> = {
  images: ["image"],
  videos: ["video"],
  documents: ["document", "word"],
  sheets: ["sheet"],
  presentations: ["presentation"],
  links: ["youtube", "drive", "link"],
};

export type MediaCategoryId = keyof typeof MEDIA_CATEGORY_TYPES;

/** The media_asset.type values a set of category chips resolves to (union, deduped). */
export function typesForCategories(categories: readonly string[]): string[] {
  const out = new Set<string>();
  for (const c of categories) {
    for (const t of MEDIA_CATEGORY_TYPES[c] ?? []) out.add(t);
  }
  return [...out];
}

/**
 * Kinds the /broadcast carousel can actually push as a card — every uploaded
 * file kind, but none of the pasted-link kinds (they have no real file behind
 * them). Mirrors MEDIA_TYPE_LABELS in publish-board.tsx.
 */
export const PUSHABLE_MEDIA_TYPES = [
  "image",
  "video",
  "document",
  "sheet",
  "presentation",
  "word",
] as const;

/** "YYYY-MM-DD", compared against the date part of created_at. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD")
  .optional();

/** Repeatable query params arrive as "a,b,c" (or absent). */
const csvList = (allowed?: readonly string[]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : []
    )
    .pipe(
      allowed
        ? z.array(z.enum(allowed as [string, ...string[]]))
        : z.array(z.string())
    );

/** Filters shared by both paging modes. */
export const mediaFilterSchema = z.object({
  /** Case-insensitive substring match on the asset name. */
  search: z.string().trim().max(200).optional(),
  /** media_asset.type values to include. Empty = no type restriction. */
  types: csvList(MEDIA_TYPES),
  /** media_asset.source values to include ('upload' | 'email' | 'link'). Empty = all. */
  sources: csvList(),
  /** Inclusive date bounds on created_at; either may be omitted for an open end. */
  dateFrom: isoDate,
  dateTo: isoDate,
});
export type MediaFilter = z.infer<typeof mediaFilterSchema>;

/**
 * One request to GET /api/media. `cursor` selects keyset mode; its presence (or
 * an explicit `mode=cursor`) is what distinguishes the two — `page` is ignored
 * in that case. A first cursor page simply omits `cursor`, so the carousel's
 * opening request and its "load more" requests take the same shape.
 */
export const listMediaQuerySchema = mediaFilterSchema.extend({
  mode: z.enum(["offset", "cursor"]).default("offset"),
  // Offset mode.
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  // Cursor mode. Opaque — built and read only by encodeMediaCursor/decodeMediaCursor.
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;

/** The row a keyset page resumes from — the last row of the previous page. */
export interface MediaCursor {
  createdAt: string;
  id: string;
}

// The cursor's encode/decode pair deliberately lives in @platform/db
// (queries/media.ts) rather than here: it is server-only, and this module is
// part of the browser bundle. A cursor is opaque to every client — it is
// produced by the query layer and handed straight back on the next request.

// mediaThumbnailSrc lives in media-content.ts, not here: this module imports
// zod, and any client component importing the helper would drag the whole
// validator into its bundle (measured: +75 kB on /screens).
