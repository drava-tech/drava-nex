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
  /** Video URLs for the "videos" grid. */
  videos?: string[];
  // ─── "gallery" type only ──────────────────────────────────────────────────
  // The text block beside the photos. The photos themselves are the first
  // GALLERY_PHOTO_COUNT entries of `images`, so a section already filled in as a
  // slideshow can be switched to "gallery" without re-picking anything.
  /** Large heading. Falls back to `name` when unset. */
  title?: string;
  /** Bold line under the title. */
  subtitle?: string;
  description?: string;
  /**
   * One entry per company whose work appears in this category — what the
   * gallery layout actually renders, and what a cross-category link points at.
   * Always at least one after normalizeSections(), migrated from the flat
   * title/subtitle/description/images above for rows saved before projects
   * existed. Only read for the "gallery" type; the other two still render
   * straight from `images`/`videos`, which is why those stay put.
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
  /** First GALLERY_PHOTO_COUNT are the gallery photos. */
  images: string[];
  /**
   * Optional film for this company. Set = the gallery page grows a "Film"
   * button that plays it in a popup; unset = no button at all, which is why
   * this is the only thing that decides whether one appears.
   */
  videoUrl?: string;
}

/** The gallery layout is designed around exactly four photos — one feature, three below. */
export const GALLERY_PHOTO_COUNT = 4;

/**
 * Label on the button a project's film gets. Fixed rather than authored — it
 * names a medium, not the content — and shared so the editor can promise
 * exactly what the screen will show.
 */
export const GALLERY_FILM_LABEL = "Film";

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
  if (section.type === "gallery") {
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
  section: Pick<PortfolioSection, "title" | "subtitle" | "description" | "images">
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
      },
    ];
  }

  return raw.map((p) => ({
    company: typeof p?.company === "string" ? p.company : "",
    ...(typeof p?.title === "string" ? { title: p.title } : {}),
    ...(typeof p?.subtitle === "string" ? { subtitle: p.subtitle } : {}),
    ...(typeof p?.description === "string" ? { description: p.description } : {}),
    images: cleanUrls(p?.images),
    // Dropped when blank rather than kept as "", so "has a film" is a single
    // truthiness test everywhere downstream.
    ...(typeof p?.videoUrl === "string" && p.videoUrl ? { videoUrl: p.videoUrl } : {}),
  }));
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
  cards.forEach((_, cardIndex) => {
    sectionsOf(cardIndex).forEach((section, sectionIndex) => {
      if (section.type !== "gallery") return;
      (section.projects ?? []).forEach((project, projectIndex) => {
        if (slugify(project.company) !== key) return;
        const isHere =
          cardIndex === here.cardIndex &&
          sectionIndex === here.sectionIndex &&
          projectIndex === here.projectIndex;
        if (isHere) return;
        links.push({ label: section.name, cardIndex, sectionIndex, projectIndex });
      });
    });
  });
  return links;
}
