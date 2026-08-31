// Content shape for the Gallery template. Stored on the experience as
// experience.templateContent.gallery. A list of pages that all share one
// layout: a text block plus four photos, where tapping a photo expands it over
// most of the screen and blurs the rest.
// Shared by the CMS (editor + preview) and the display (live render).

export interface GalleryPhoto {
  /** Media-library URL, chosen with MediaPicker. Empty = an unfilled slot. */
  url: string;
  /** Optional label shown over the photo while it is expanded. */
  caption?: string;
}

/**
 * One gallery page. Every page uses the identical layout — only the copy and
 * the photos differ — so styling deliberately lives on GalleryContent, not
 * here: adding a page can never make it look different from the others.
 */
export interface GalleryPage {
  /** Editor-facing name, and the source of this page's URL slug. */
  name: string;
  title: string;
  /** Bold line under the title (e.g. a category). */
  subtitle?: string;
  description?: string;
  /** Always exactly PHOTO_COUNT after normalizePages(). */
  photos: GalleryPhoto[];
}

export interface GalleryContent {
  /** At least one after normalizePages(). */
  pages: GalleryPage[];

  // ─── Style — shared by every page, by design (px unless noted) ────────────
  titleFontSize?: number;
  subtitleFontSize?: number;
  descriptionFontSize?: number;
  /** Gap between grid cells. */
  gap?: number;
  /** Outer margin around the whole layout. Independent of `gap` — the
   *  reference proportions have a much wider outer margin than inner gutter. */
  padding?: number;
  backgroundColor?: string;
  textColor?: string;
  /** Share of the width an expanded photo takes, in percent. */
  expandedPct?: number;
  /** Blur applied to the un-expanded remainder. */
  blurPx?: number;
}

/** The layout is designed around exactly four photos — one feature, three below. */
export const PHOTO_COUNT = 4;

export const DEFAULT_TITLE_FONT_SIZE = 64;
export const DEFAULT_SUBTITLE_FONT_SIZE = 24;
export const DEFAULT_DESCRIPTION_FONT_SIZE = 20;
export const DEFAULT_GAP = 26;
// Measured off the reference layout: the outer margin is ~3x the inner gutter.
export const DEFAULT_PADDING = 78;
export const DEFAULT_BACKGROUND_COLOR = "#e8e8f7";
export const DEFAULT_TEXT_COLOR = "#111114";
export const DEFAULT_EXPANDED_PCT = 70;
export const DEFAULT_BLUR_PX = 12;

/** Bounds shared by the editor's controls and the renderer's clamping. */
export const EXPANDED_PCT_MIN = 40;
export const EXPANDED_PCT_MAX = 90;
export const BLUR_PX_MIN = 0;
export const BLUR_PX_MAX = 40;

export const emptyPhotos = (): GalleryPhoto[] =>
  Array.from({ length: PHOTO_COUNT }, () => ({ url: "" }));

/** A fresh page, used by the editor's "Add page" and as the fallback content. */
export function newGalleryPage(name = "New page"): GalleryPage {
  return { name, title: name, subtitle: "", description: "", photos: emptyPhotos() };
}

export const DEFAULT_GALLERY_CONTENT: GalleryContent = {
  titleFontSize: DEFAULT_TITLE_FONT_SIZE,
  subtitleFontSize: DEFAULT_SUBTITLE_FONT_SIZE,
  descriptionFontSize: DEFAULT_DESCRIPTION_FONT_SIZE,
  gap: DEFAULT_GAP,
  padding: DEFAULT_PADDING,
  backgroundColor: DEFAULT_BACKGROUND_COLOR,
  textColor: DEFAULT_TEXT_COLOR,
  expandedPct: DEFAULT_EXPANDED_PCT,
  blurPx: DEFAULT_BLUR_PX,
  pages: [
    {
      name: "3D Narratives",
      title: "3D Narratives",
      subtitle: "Corporate Films",
      description:
        "This corporate film explores storytelling through sculpted forms, digital environments, and layered motion. Abstract spaces, character movement, and visual rhythm come together to create immersive narratives.",
      photos: emptyPhotos(),
    },
  ],
};

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Always exactly PHOTO_COUNT well-formed slots — padded and truncated. */
export function normalizePhotos(photos?: GalleryPhoto[]): GalleryPhoto[] {
  const list = Array.isArray(photos) ? photos : [];
  return Array.from({ length: PHOTO_COUNT }, (_, i) => {
    const p = list[i];
    return {
      url: typeof p?.url === "string" ? p.url : "",
      ...(typeof p?.caption === "string" && p.caption ? { caption: p.caption } : {}),
    };
  });
}

/**
 * Always returns at least one well-formed page. Also migrates the original
 * single-page shape (title/subtitle/description/photos at the top level), so
 * rows saved before pages existed still open instead of coming back blank.
 */
export function normalizePages(content?: Partial<GalleryContent> & LegacySinglePage): GalleryPage[] {
  const raw = Array.isArray(content?.pages) ? content.pages : [];

  if (raw.length === 0 && (content?.title || content?.photos)) {
    const name = content.title || "Page 1";
    return [
      {
        name,
        title: content.title ?? name,
        ...(content.subtitle ? { subtitle: content.subtitle } : {}),
        ...(content.description ? { description: content.description } : {}),
        photos: normalizePhotos(content.photos),
      },
    ];
  }

  if (raw.length === 0) return [newGalleryPage("Page 1")];

  return raw.map((p, i) => {
    const name = (p?.name ?? "").trim() || (p?.title ?? "").trim() || `Page ${i + 1}`;
    return {
      name,
      title: typeof p?.title === "string" ? p.title : name,
      ...(typeof p?.subtitle === "string" ? { subtitle: p.subtitle } : {}),
      ...(typeof p?.description === "string" ? { description: p.description } : {}),
      photos: normalizePhotos(p?.photos),
    };
  });
}

/** Shape of the pre-pages content, accepted by normalizePages for migration. */
interface LegacySinglePage {
  title?: string;
  subtitle?: string;
  description?: string;
  photos?: GalleryPhoto[];
}

/** Reads the gallery content slice off an experience row, or null if unset. */
export function readGalleryContent(
  templateContent: Record<string, unknown> | null | undefined
): GalleryContent | null {
  const slice = templateContent?.["gallery"];
  if (!slice || typeof slice !== "object") return null;
  const merged = { ...DEFAULT_GALLERY_CONTENT, ...(slice as Partial<GalleryContent>) };
  return { ...merged, pages: normalizePages(slice as Partial<GalleryContent> & LegacySinglePage) };
}

/** URL-safe segment from a display name: "3D Narratives" → "3d-narratives". */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Deterministic unique slugs for the pages — shared by the layout (which reads
 * a URL back into a page index) and any nav that writes one, so links stay
 * stable as long as names do.
 */
export function pageSlugs(pages: GalleryPage[]): string[] {
  const seen = new Set<string>();
  return pages.map((p, i) => {
    let slug = slugify(p.name) || `page-${i + 1}`;
    if (seen.has(slug)) slug = `${slug}-${i + 1}`;
    seen.add(slug);
    return slug;
  });
}
