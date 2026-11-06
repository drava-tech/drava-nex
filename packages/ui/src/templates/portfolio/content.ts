// Content shape for the Portfolio template. Stored on the experience as
// experience.templateContent.portfolio. Per-view so future views add their own slice.
// Shared by the CMS (editor + preview) and the screens app (live render).

/**
 * One drill-in section of a vertical: a button on the vertical page leading to
 * either an image slideshow or a videos grid (chosen per button in the editor).
 */
/** What a section button opens once the split-view slider commits. */
export type PortfolioSectionType = "images" | "videos" | "gallery";

export interface PortfolioSection {
  name: string;
  /** What this button opens. Missing (older rows) → "images". */
  type?: PortfolioSectionType;
  images: string[];
  /** Video URLs — only meaningful for the flat "images" type's legacy shim; see `videos` on `PortfolioProject` for "videos" type content. */
  videos?: string[];
  // ─── "gallery" and "videos" types only ────────────────────────────────────
  // The text block beside the photos/videos. The photos themselves are the
  // first GALLERY_PHOTO_COUNT entries of `images`, so a section already
  // filled in as a slideshow can be switched to "gallery" without re-picking
  // anything.
  /** Large heading. Falls back to `name` when unset. */
  title?: string;
  /** Bold line under the title. */
  subtitle?: string;
  description?: string;
  /** Vestigial — "gallery" vs "videos" is now decided entirely by `type`, not this flag. Left in the shape for old stored rows; no longer read by any view. */
  galleryKind?: "photos" | "videos";
  /**
   * One entry per company whose work appears in this category — what the
   * "gallery" (photo) and "videos" (film grid) layouts both actually render,
   * and what a cross-category link points at. Always at least one after
   * normalizeSections(), migrated from the flat title/subtitle/description/
   * images/videos above for rows saved before projects existed. Only read
   * for those two types; a plain "images" slideshow still renders straight
   * from `images`, which is why that stays put.
   */
  projects?: PortfolioProject[];
}

/**
 * One company's work inside one category — "Collins Aerospace, Brand Films".
 *
 * Exists so a company can be addressed on its own: before this, a category held
 * a single gallery, and there was no way to point at one client's four photos
 * rather than another's. That address is what the cross-category buttons need.
 */
export interface PortfolioProject {
  /**
   * Authoring-only, never rendered. The cross-link key: projects whose company
   * slugifies the same are the same client wherever they live, which is what
   * decides the buttons on the gallery page. Blank = not linked to anything.
   */
  company: string;
  /** Large heading. Falls back to the section name when unset. */
  title?: string;
  /** Bold line under the title. */
  subtitle?: string;
  description?: string;
  /** First GALLERY_PHOTO_COUNT are the gallery photos — only rendered when the parent category's type is "gallery". */
  images: string[];
  /**
   * This company's films — only rendered (as a tile in the shared film grid,
   * opening the full-screen player) when the parent category's type is
   * "videos". Reaching this page is always a navigation from the company's
   * other category (the cross-category "links" row), never a popup.
   */
  videos?: string[];
}

/** The gallery layout is designed around exactly four photos — one feature, three below. */
export const GALLERY_PHOTO_COUNT = 4;

/**
 * Styling for every "gallery" section, held once on the content rather than
 * per-section: new gallery sections are new copy and new photos, never a new
 * design. Mirrors how overview.* holds one set of values for all three cards.
 */
export interface PortfolioGalleryStyle {
  titleFontSize?: number;
  subtitleFontSize?: number;
  descriptionFontSize?: number;
  gap?: number;
  /** Outer margin around the layout — deliberately larger than `gap`. */
  padding?: number;
  backgroundColor?: string;
  textColor?: string;
  /** Share of the width an expanded photo takes, in percent. */
  expandedPct?: number;
  /** Blur applied to the un-expanded remainder. */
  blurPx?: number;
}

export const DEFAULT_GALLERY_TITLE_FONT_SIZE = 64;
export const DEFAULT_GALLERY_SUBTITLE_FONT_SIZE = 24;
export const DEFAULT_GALLERY_DESCRIPTION_FONT_SIZE = 20;
export const DEFAULT_GALLERY_GAP = 26;
export const DEFAULT_GALLERY_PADDING = 78;
export const DEFAULT_GALLERY_BACKGROUND_COLOR = "#e8e8f7";
export const DEFAULT_GALLERY_TEXT_COLOR = "#111114";
export const DEFAULT_GALLERY_EXPANDED_PCT = 70;
export const DEFAULT_GALLERY_BLUR_PX = 12;

/** Bounds shared by the editor's controls and the view's clamping. */
export const GALLERY_EXPANDED_PCT_MIN = 40;
export const GALLERY_EXPANDED_PCT_MAX = 90;
export const GALLERY_BLUR_PX_MIN = 0;
export const GALLERY_BLUR_PX_MAX = 40;

export const DEFAULT_PORTFOLIO_GALLERY_STYLE: Required<PortfolioGalleryStyle> = {
  titleFontSize: DEFAULT_GALLERY_TITLE_FONT_SIZE,
  subtitleFontSize: DEFAULT_GALLERY_SUBTITLE_FONT_SIZE,
  descriptionFontSize: DEFAULT_GALLERY_DESCRIPTION_FONT_SIZE,
  gap: DEFAULT_GALLERY_GAP,
  padding: DEFAULT_GALLERY_PADDING,
  backgroundColor: DEFAULT_GALLERY_BACKGROUND_COLOR,
  textColor: DEFAULT_GALLERY_TEXT_COLOR,
  expandedPct: DEFAULT_GALLERY_EXPANDED_PCT,
  blurPx: DEFAULT_GALLERY_BLUR_PX,
};

export function clampGalleryValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export interface OverviewCard {
  title: string;
  imageUrl: string;
  /** Video played in a popup when the first ("Watch Video") button is tapped. */
  videoUrl?: string;
  /** Shown below the image, above the buttons. Optional — older rows lack it. */
  description?: string;
  button1: string;
  button2: string;
  /** Exactly 2 after normalizeSections(); optional in storage (older rows lack it). */
  sections?: PortfolioSection[];
}

/** Which portfolio page is showing: overview (cardIndex null), a vertical, or a section slideshow. */
export interface PortfolioViewState {
  cardIndex: number | null;
  sectionIndex: number | null;
  /**
   * Which company's project inside a "gallery" section. Absent/null → the
   * first, so every existing caller and stored URL keeps working untouched.
   */
  projectIndex?: number | null;
  /** When true, renders the split-panel comparison view instead of the vertical page. */
  splitView?: boolean;
  /** Set when the vertical page was reached by dragging past the threshold in
   * the split view — its back button returns to the split view instead of
   * the overview. */
  cameFromSplit?: boolean;
  /**
   * Set when this page was reached by a sideways jump from another category
   * (the "also seen in…" links on a company page). Its back button returns to
   * that page rather than to the split view or overview. One level deep: the
   * origin's own origin is not kept.
   */
  from?: PortfolioOrigin;
}

/** A company page a sideways jump started from — enough to go back to it. */
export interface PortfolioOrigin {
  cardIndex: number;
  sectionIndex: number;
  projectIndex: number;
  cameFromSplit?: boolean;
}

export interface PortfolioContent {
  /** One set of style values for every "gallery" section — see the type above. */
  gallery?: PortfolioGalleryStyle;
  overview: {
    cards: OverviewCard[];
    /** Style values (px) — one set shared by all 3 cards. */
    titleFontSize?: number;
    descriptionFontSize?: number;
    buttonFontSize?: number;
    // Card padding drives spacing throughout — outer padding AND the space
    // between title / image / description / buttons.
    cardPadding?: number;
  };
}

export const DEFAULT_TITLE_FONT_SIZE = 50;
export const DEFAULT_DESCRIPTION_FONT_SIZE = 22;
export const DEFAULT_BUTTON_FONT_SIZE = 20;
export const DEFAULT_CARD_PADDING = 44;

export const DEFAULT_SECTIONS: PortfolioSection[] = [
  { name: "Build", type: "images", images: [], videos: [] },
  { name: "Technology", type: "images", images: [], videos: [] },
];

const defaultSections = (): PortfolioSection[] =>
  DEFAULT_SECTIONS.map((s) => ({ name: s.name, type: s.type, images: [], videos: [] }));

export const DEFAULT_PORTFOLIO_CONTENT: PortfolioContent = {
  overview: {
    titleFontSize: DEFAULT_TITLE_FONT_SIZE,
    descriptionFontSize: DEFAULT_DESCRIPTION_FONT_SIZE,
    buttonFontSize: DEFAULT_BUTTON_FONT_SIZE,
    cardPadding: DEFAULT_CARD_PADDING,
    cards: [
      {
        title: "Experience Center",
        imageUrl: "/media/experience-center.png",
        videoUrl: "",
        description: "A hands-on showcase of our flagship spaces, walking through the ideas and craft behind every build.",
        button1: "Watch Video",
        button2: "Projects",
        sections: defaultSections(),
      },
      {
        title: "Architecture & Interiors",
        imageUrl: "/media/interior-space.png",
        videoUrl: "",
        description: "Selected projects spanning residential, commercial, and hospitality interiors, from concept to completion.",
        button1: "Watch Video",
        button2: "Projects",
        sections: defaultSections(),
      },
      {
        title: "Brand Solutions",
        imageUrl: "/media/brand-experiences.png",
        videoUrl: "",
        description: "Brand identities and campaigns crafted to help our clients stand out across every touchpoint.",
        button1: "Watch Video",
        button2: "Projects",
        sections: defaultSections(),
      },
    ],
  },
};

/**
 * Always returns exactly 2 well-formed sections. Older stored rows lack
 * `sections` entirely — blank/missing names fall back to the defaults and
 * missing image lists become empty.
 */
const cleanUrls = (raw: unknown): string[] =>
  (Array.isArray(raw) ? raw : []).filter((u): u is string => typeof u === "string" && u.length > 0);

export function normalizeSections(sections?: PortfolioSection[]): PortfolioSection[] {
  return DEFAULT_SECTIONS.map((def, i) => {
    const s = sections?.[i];
    const name = (s?.name ?? "").trim() || def.name;
    const type: PortfolioSectionType =
      s?.type === "videos" ? "videos" : s?.type === "gallery" ? "gallery" : "images";
    const section: PortfolioSection = {
      name,
      type,
      images: cleanUrls(s?.images),
      videos: cleanUrls(s?.videos),
      // Carried through for every type, not just "gallery", so switching a
      // section back and forth doesn't quietly discard its copy.
      ...(typeof s?.title === "string" ? { title: s.title } : {}),
      ...(typeof s?.subtitle === "string" ? { subtitle: s.subtitle } : {}),
      ...(typeof s?.description === "string" ? { description: s.description } : {}),
      // "gallery" only, but carried through unconditionally like the fields
      // above — dropping it here would silently fall the video grid back to
      // the photo grid on every normalize pass.
      ...(s?.galleryKind ? { galleryKind: s.galleryKind } : {}),
    };
    return { ...section, projects: normalizeProjects(s?.projects, section) };
  });
}

/**
 * The still that stands for a whole category — the split view's panel cover.
 *
 * A gallery's photos live on its projects, so a category authored entirely
 * through companies has nothing in the section's own `images` and would show a
 * blank panel if that were read directly. Falls back to it regardless, which is
 * what a slideshow or videos category (and a pre-companies gallery) still uses.
 */
export function sectionCoverImage(section: PortfolioSection): string | undefined {
  if (section.type === "gallery" || section.type === "videos") {
    const cover = (section.projects ?? []).find((p) => p.images[0])?.images[0];
    if (cover) return cover;
  }
  return section.images[0];
}

/** A fresh project, used by the editor's "Add company" and by the migration below. */
export function newPortfolioProject(company = ""): PortfolioProject {
  return { company, title: "", subtitle: "", description: "", images: [] };
}

/**
 * Always at least one well-formed project. Also migrates the pre-projects shape
 * — one gallery per category, its copy and photos held flat on the section — by
 * folding those fields into a single unnamed project, so a category authored
 * before this existed renders exactly as it did and simply links to nothing.
 *
 * Mirrors how normalizePages migrates the Gallery template's own legacy
 * single-page rows.
 */
export function normalizeProjects(
  projects: PortfolioProject[] | undefined,
  section: Pick<PortfolioSection, "title" | "subtitle" | "description" | "images" | "videos">
): PortfolioProject[] {
  const raw = Array.isArray(projects) ? projects : [];

  if (raw.length === 0) {
    return [
      {
        company: "",
        ...(typeof section.title === "string" ? { title: section.title } : {}),
        ...(typeof section.subtitle === "string" ? { subtitle: section.subtitle } : {}),
        ...(typeof section.description === "string" ? { description: section.description } : {}),
        images: cleanUrls(section.images),
        videos: cleanUrls(section.videos ?? []),
      },
    ];
  }

  return raw.map((p) => {
    // Legacy shim: older rows carry a single `videoUrl` string instead of the
    // current `videos` array — coalesce so both shapes normalize the same way.
    const legacyVideoUrl = (p as unknown as { videoUrl?: unknown })?.videoUrl;
    const videos = Array.isArray(p?.videos)
      ? cleanUrls(p.videos)
      : typeof legacyVideoUrl === "string" && legacyVideoUrl
        ? [legacyVideoUrl]
        : [];

    return {
      company: typeof p?.company === "string" ? p.company : "",
      ...(typeof p?.title === "string" ? { title: p.title } : {}),
      ...(typeof p?.subtitle === "string" ? { subtitle: p.subtitle } : {}),
      ...(typeof p?.description === "string" ? { description: p.description } : {}),
      images: cleanUrls(p?.images),
      videos,
    };
  });
}

/** Reads the portfolio content slice off an experience row, or null if unset. */
export function readPortfolioContent(
  templateContent: Record<string, unknown> | null | undefined
): PortfolioContent | null {
  const slice = templateContent?.["portfolio"];
  if (!slice) return null;
  const content = slice as PortfolioContent;
  const cards = content.overview?.cards;
  if (!Array.isArray(cards)) return content;
  return {
    ...content,
    overview: {
      ...content.overview,
      cards: cards.map((c) => ({ ...c, sections: normalizeSections(c.sections) })),
    },
  };
}

/** URL-safe segment from a display name: "Architecture & Interiors" → "architecture-interiors". */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Deterministic unique slugs for a list of names (fallback + `-${i+1}` suffix on collision). */
function uniqueSlugs(names: string[], fallbackPrefix: string): string[] {
  const seen = new Set<string>();
  return names.map((name, i) => {
    let slug = slugify(name) || `${fallbackPrefix}-${i + 1}`;
    if (seen.has(slug)) slug = `${slug}-${i + 1}`;
    seen.add(slug);
    return slug;
  });
}

/** Route segments for the vertical cards — shared by the CMS layout and nav so URLs stay consistent. */
export function cardSlugs(cards: OverviewCard[]): string[] {
  return uniqueSlugs(cards.map((c) => c.title), "vertical");
}

/**
 * Reserved second URL segment (`/<vertical-slug>/split-view`) that marks the
 * split-panel view instead of a section slideshow — shared by the routed nav
 * (which writes it) and the URL→view resolver (which reads it), so the
 * standalone preview tab's real URL navigation can represent `splitView`,
 * which a plain section-slug lookup has no way to encode.
 */
export const SPLIT_VIEW_SEGMENT = "split-view";

/** Route segments for a card's sections. */
export function sectionSlugs(sections: PortfolioSection[]): string[] {
  return uniqueSlugs(sections.map((s) => s.name), "section");
}

/**
 * Route segments for a gallery section's projects — the company name, so the
 * URL reads `/brand-experience/brand-films/collins-aerospace`. Projects with no
 * company fall back to their title, then to a positional slug.
 */
export function projectSlugs(projects: PortfolioProject[]): string[] {
  return uniqueSlugs(
    projects.map((p) => p.company || p.title || ""),
    "project"
  );
}

/** Where a project lives, and the category name to label a link to it with. */
export interface CompanyLink {
  /** The category's own name — "Brand Films". */
  label: string;
  cardIndex: number;
  sectionIndex: number;
  projectIndex: number;
}

/**
 * Every OTHER category holding work for the same company as `here`.
 *
 * This is what the gallery page's button row is built from, and it is derived
 * rather than authored: tagging a project with a company is the whole act of
 * linking it: no link lists to keep in sync, and adding a fourth category for a
 * client makes it appear on the other three by itself.
 *
 * Matching is on the slugified company, so "Collins Aerospace" and
 * "collins aerospace" are one client. A blank company matches nothing —
 * otherwise every untagged project in the portfolio would link to every other.
 *
 * Ordered by card then section, so the row stays put as you move between a
 * company's pages instead of reshuffling under the finger.
 *
 * One link per CATEGORY, not per project — a company can have more than one
 * project tagged within the same category (e.g. two Collins Aerospace
 * entries under "Brand Experiences"), and that must still produce a single
 * "Brand Experiences" button, not one per matching project. The first
 * matching project in a category is what the link points at.
 *
 * The category `here` is standing in is skipped entirely, even when a
 * sibling project in that same category matches — switching between two
 * projects of the same company in one category is the pager's job, not
 * this row's; a "Brand Experiences" button while already inside Brand
 * Experiences would just duplicate it.
 */
export function companyLinks(
  cards: OverviewCard[],
  here: { cardIndex: number; sectionIndex: number; projectIndex: number }
): CompanyLink[] {
  const sectionsOf = (ci: number) => normalizeSections(cards[ci]?.sections);
  const current = sectionsOf(here.cardIndex)[here.sectionIndex]?.projects?.[here.projectIndex];
  const key = slugify(current?.company ?? "");
  if (!key) return [];

  const links: CompanyLink[] = [];
  const seenCategories = new Set<string>();
  cards.forEach((_, cardIndex) => {
    sectionsOf(cardIndex).forEach((section, sectionIndex) => {
      // Both "gallery" (photos) and "videos" (film grid) are project/company-
      // scoped types — either can be a link source or target. Only "images"
      // (a flat, company-less slideshow) has nothing to link.
      if (section.type !== "gallery" && section.type !== "videos") return;
      const isHereCategory = cardIndex === here.cardIndex && sectionIndex === here.sectionIndex;
      if (isHereCategory) return;
      (section.projects ?? []).forEach((project, projectIndex) => {
        if (slugify(project.company) !== key) return;
        const categoryKey = `${cardIndex}-${sectionIndex}`;
        if (seenCategories.has(categoryKey)) return;
        seenCategories.add(categoryKey);
        links.push({ label: section.name, cardIndex, sectionIndex, projectIndex });
      });
    });
  });
  return links;
}
