/**
 * Client-side media tile helpers.
 *
 * These deliberately live in the CMS rather than in @platform/types, even
 * though that is where the rest of the media contract lives.
 *
 * @platform/types compiles to CommonJS (tsconfig.base.json sets
 * module: "NodeNext"), and CommonJS cannot be tree-shaken. So importing a
 * single runtime *value* from it pulls the entire barrel — including zod, via
 * media-listing.ts — into whatever client bundle did the importing. Measured:
 * adding one such import to the screens assignment picker took /screens from
 * 174 kB to 249 kB of First Load JS. Marking the package sideEffects:false and
 * adding optimizePackageImports does not help, because the emitted format is
 * the blocker.
 *
 * Type-only imports from @platform/types remain free — they are erased at
 * compile time. It is only runtime values that carry the barrel.
 *
 * The real fix is emitting ESM from @platform/types, which is a larger change
 * across the monorepo (the API and scripts consume it as CJS today). Until
 * then, keep client-side constants and pure helpers here.
 */

/**
 * Which URL a small tile should load for a media asset.
 *
 * The single place the thumbnail-vs-original decision is made, because getting
 * it wrong is silent: the tile still renders, it just quietly costs megabytes.
 * Falls back to the original when no thumbnail exists — videos, links, and any
 * image uploaded before the backfill ran.
 */
export function mediaThumbnailSrc(asset: {
  url: string;
  thumbnailUrl?: string | null;
}): string {
  return asset.thumbnailUrl || asset.url;
}

/**
 * Media kinds the /broadcast carousel can push as a card: every uploaded file
 * kind, but none of the pasted-link kinds (youtube/drive/link), which have no
 * real file behind them. Mirrors PUSHABLE_MEDIA_TYPES in @platform/types —
 * kept in sync by hand for the bundle reason above.
 */
export const PUSHABLE_MEDIA_TYPES = [
  "image",
  "video",
  "document",
  "sheet",
  "presentation",
  "word",
] as const;

/**
 * The Media Library's category chips, expanded to the media_asset.type values
 * each covers. Selecting several categories is an OR (the union of their
 * types). Mirrors MEDIA_CATEGORY_TYPES in @platform/types.
 */
const MEDIA_CATEGORY_TYPES: Record<string, readonly string[]> = {
  images: ["image"],
  videos: ["video"],
  documents: ["document", "word"],
  sheets: ["sheet"],
  presentations: ["presentation"],
  links: ["youtube", "drive", "link"],
};

/** The media_asset.type values a set of category chips resolves to (deduped). */
export function typesForCategories(categories: readonly string[]): string[] {
  const out = new Set<string>();
  for (const c of categories) {
    for (const t of MEDIA_CATEGORY_TYPES[c] ?? []) out.add(t);
  }
  return [...out];
}

/** Kinds added by pasting a URL rather than uploading a file. */
const LINK_MEDIA_TYPES = new Set(["youtube", "drive", "link"]);

export function isLinkMediaType(type: string): boolean {
  return LINK_MEDIA_TYPES.has(type);
}
