import { eq, asc, and } from "drizzle-orm";
import { db } from "../client.js";
import {
  portfolioVertical,
  portfolioCategory,
  portfolioCategoryImage,
  portfolioCategoryVideo,
  portfolioProject,
  portfolioProjectImage,
  portfolioProjectVideo,
  portfolioSettings,
  type PortfolioCategory,
  type PortfolioVertical,
  type PortfolioProject,
  type PortfolioSettings,
} from "../schema/portfolio.js";
import { findOrCreateCompanyByName } from "./companies.js";

/**
 * Portfolio data access — the relational replacement for
 * `experience.templateContent.portfolio` (JSONB), scoped only to the
 * portfolio template. `getPortfolioTree` is the assembler: it reshapes the
 * relational rows into the same `PortfolioContent`-shaped object the CMS
 * editor/preview and live renderer already understand, so no other file has
 * to change to consume it (only their data *source* changes).
 */

// ─── Errors ───────────────────────────────────────────────────────────────────

export class PortfolioNotFoundError extends Error {
  constructor(message = "Portfolio row not found") {
    super(message);
    this.name = "PortfolioNotFoundError";
  }
}

export class PortfolioValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortfolioValidationError";
  }
}

// ─── Assembled shape (structurally == PortfolioContent in packages/ui) ────────
// Kept local rather than imported — @platform/db has no dependency on
// @platform/ui. TypeScript's structural typing makes this assignable to
// PortfolioContent at every call site without a cast, as long as the shapes
// stay in sync with packages/ui/src/templates/portfolio/content.ts.

export interface AssembledPortfolioProject {
  /** Real portfolio_project.id — additive, only the editor reads this; renderers ignore it. */
  id: string;
  /** Real company.id (or null if unlinked) — additive, editor-only. */
  companyId: string | null;
  company: string;
  title?: string;
  subtitle?: string;
  description?: string;
  images: string[];
  /** portfolio_project_image.id, parallel to `images` (same order) — editor-only. */
  imageIds: string[];
  videos?: string[];
  /** portfolio_project_video.id, parallel to `videos` (same order) — editor-only. */
  videoIds: string[];
}

export interface AssembledPortfolioSection {
  name: string;
  type?: "images" | "videos" | "gallery";
  images: string[];
  videos?: string[];
  title?: string;
  subtitle?: string;
  description?: string;
  /** Only meaningful when type === "gallery" — photo grid vs video grid per company. */
  galleryKind?: "photos" | "videos";
  /** Real portfolio_category.id — additive, editor-only (e.g. "add project to this category"). */
  categoryId: string;
  projects?: AssembledPortfolioProject[];
}

export interface AssembledOverviewCard {
  title: string;
  imageUrl: string;
  videoUrl?: string;
  description?: string;
  button1: string;
  button2: string;
  sections?: AssembledPortfolioSection[];
}

export interface AssembledPortfolioContent {
  gallery?: {
    titleFontSize?: number;
    subtitleFontSize?: number;
    descriptionFontSize?: number;
    gap?: number;
    padding?: number;
    backgroundColor?: string;
    textColor?: string;
    expandedPct?: number;
    blurPx?: number;
  };
  overview: {
    cards: AssembledOverviewCard[];
    titleFontSize?: number;
    descriptionFontSize?: number;
    buttonFontSize?: number;
    cardPadding?: number;
  };
}

/** Reads the full portfolio tree for an experience, reassembled into the JSON shape every renderer already reads. */
export async function getPortfolioTree(experienceId: string): Promise<AssembledPortfolioContent | null> {
  const verticals = await db.query.portfolioVertical.findMany({
    where: eq(portfolioVertical.experienceId, experienceId),
    orderBy: asc(portfolioVertical.slotIndex),
    with: {
      categories: {
        orderBy: asc(portfolioCategory.slotIndex),
        with: {
          images: { orderBy: asc(portfolioCategoryImage.sortOrder) },
          videos: { orderBy: asc(portfolioCategoryVideo.sortOrder) },
          projects: {
            orderBy: asc(portfolioProject.sortOrder),
            with: {
              images: { orderBy: asc(portfolioProjectImage.sortOrder) },
              videos: { orderBy: asc(portfolioProjectVideo.sortOrder) },
              company: true,
            },
          },
        },
      },
    },
  });

  if (verticals.length === 0) return null;

  const settings = await db.query.portfolioSettings.findFirst({
    where: eq(portfolioSettings.experienceId, experienceId),
  });

  const cards: AssembledOverviewCard[] = verticals.map((v) => ({
    title: v.title,
    imageUrl: v.imageUrl,
    ...(v.videoUrl ? { videoUrl: v.videoUrl } : {}),
    ...(v.description ? { description: v.description } : {}),
    button1: v.button1,
    button2: v.button2,
    sections: v.categories.map((c) => ({
      name: c.name,
      type: c.type,
      images: c.images.map((i) => i.url),
      videos: c.videos.map((vid) => vid.url),
      ...(c.title ? { title: c.title } : {}),
      ...(c.subtitle ? { subtitle: c.subtitle } : {}),
      ...(c.description ? { description: c.description } : {}),
      ...(c.type === "gallery" ? { galleryKind: c.galleryKind } : {}),
      categoryId: c.id,
      projects: c.projects.map((p) => ({
        id: p.id,
        companyId: p.companyId,
        company: p.company?.name ?? "",
        ...(p.title ? { title: p.title } : {}),
        ...(p.subtitle ? { subtitle: p.subtitle } : {}),
        ...(p.description ? { description: p.description } : {}),
        images: p.images.map((i) => i.url),
        imageIds: p.images.map((i) => i.id),
        videos: p.videos.map((vid) => vid.url),
        videoIds: p.videos.map((vid) => vid.id),
      })),
    })),
  }));

  return {
    gallery: settings
      ? {
          titleFontSize: settings.galleryTitleFontSize,
          subtitleFontSize: settings.gallerySubtitleFontSize,
          descriptionFontSize: settings.galleryDescriptionFontSize,
          gap: settings.galleryGap,
          padding: settings.galleryPadding,
          backgroundColor: settings.galleryBackgroundColor,
          textColor: settings.galleryTextColor,
          expandedPct: settings.galleryExpandedPct,
          blurPx: settings.galleryBlurPx,
        }
      : undefined,
    overview: {
      cards,
      titleFontSize: settings?.overviewTitleFontSize,
      descriptionFontSize: settings?.overviewDescriptionFontSize,
      buttonFontSize: settings?.overviewButtonFontSize,
      cardPadding: settings?.overviewCardPadding,
    },
  };
}

// ─── Verticals (fixed 3 slots — update only, no create/delete/reorder) ────────

export interface UpdateVerticalInput {
  title?: string;
  imageUrl?: string;
  videoUrl?: string | null;
  description?: string | null;
  button1?: string;
  button2?: string;
}

export async function updateVertical(
  verticalId: string,
  input: UpdateVerticalInput
): Promise<PortfolioVertical> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if ("title" in input) patch["title"] = input.title;
  if ("imageUrl" in input) patch["imageUrl"] = input.imageUrl;
  if ("videoUrl" in input) patch["videoUrl"] = input.videoUrl ?? null;
  if ("description" in input) patch["description"] = input.description ?? null;
  if ("button1" in input) patch["button1"] = input.button1;
  if ("button2" in input) patch["button2"] = input.button2;

  const [row] = await db
    .update(portfolioVertical)
    .set(patch)
    .where(eq(portfolioVertical.id, verticalId))
    .returning();
  if (!row) throw new PortfolioNotFoundError("Vertical not found");
  return row;
}

// ─── Categories (fixed 2 slots per vertical — update only, incl. type switch) ─

export interface UpdateCategoryInput {
  name?: string;
  type?: "images" | "videos" | "gallery";
  /** Only meaningful when type === "gallery" — photo grid vs video grid per company. */
  galleryKind?: "photos" | "videos";
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
}

export async function updateCategory(
  categoryId: string,
  input: UpdateCategoryInput
): Promise<PortfolioCategory> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if ("name" in input) patch["name"] = input.name;
  if ("type" in input) patch["type"] = input.type;
  if ("galleryKind" in input) patch["galleryKind"] = input.galleryKind;
  if ("title" in input) patch["title"] = input.title ?? null;
  if ("subtitle" in input) patch["subtitle"] = input.subtitle ?? null;
  if ("description" in input) patch["description"] = input.description ?? null;

  const [row] = await db
    .update(portfolioCategory)
    .set(patch)
    .where(eq(portfolioCategory.id, categoryId))
    .returning();
  if (!row) throw new PortfolioNotFoundError("Category not found");
  return row;
}

async function getCategoryOrThrow(categoryId: string): Promise<PortfolioCategory> {
  const [row] = await db
    .select()
    .from(portfolioCategory)
    .where(eq(portfolioCategory.id, categoryId))
    .limit(1);
  if (!row) throw new PortfolioNotFoundError("Category not found");
  return row;
}

// ─── Category images / videos (free lists) ─────────────────────────────────────

export async function addCategoryImage(categoryId: string, url: string, sortOrder = 0) {
  await getCategoryOrThrow(categoryId);
  const [row] = await db
    .insert(portfolioCategoryImage)
    .values({ categoryId, url, sortOrder })
    .returning();
  if (!row) throw new Error("Failed to add category image");
  return row;
}

export async function removeCategoryImage(categoryId: string, imageId: string): Promise<void> {
  const rows = await db
    .delete(portfolioCategoryImage)
    .where(and(eq(portfolioCategoryImage.id, imageId), eq(portfolioCategoryImage.categoryId, categoryId)))
    .returning({ id: portfolioCategoryImage.id });
  if (rows.length === 0) throw new PortfolioNotFoundError("Category image not found");
}

export async function reorderCategoryImages(categoryId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(portfolioCategoryImage)
        .set({ sortOrder: i })
        .where(and(eq(portfolioCategoryImage.id, orderedIds[i]!), eq(portfolioCategoryImage.categoryId, categoryId)));
    }
  });
}

export async function addCategoryVideo(categoryId: string, url: string, sortOrder = 0) {
  await getCategoryOrThrow(categoryId);
  const [row] = await db
    .insert(portfolioCategoryVideo)
    .values({ categoryId, url, sortOrder })
    .returning();
  if (!row) throw new Error("Failed to add category video");
  return row;
}

export async function removeCategoryVideo(categoryId: string, videoId: string): Promise<void> {
  const rows = await db
    .delete(portfolioCategoryVideo)
    .where(and(eq(portfolioCategoryVideo.id, videoId), eq(portfolioCategoryVideo.categoryId, categoryId)))
    .returning({ id: portfolioCategoryVideo.id });
  if (rows.length === 0) throw new PortfolioNotFoundError("Category video not found");
}

export async function reorderCategoryVideos(categoryId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(portfolioCategoryVideo)
        .set({ sortOrder: i })
        .where(and(eq(portfolioCategoryVideo.id, orderedIds[i]!), eq(portfolioCategoryVideo.categoryId, categoryId)));
    }
  });
}

// ─── Projects (free, add/remove/reorder list inside a "gallery" category) ─────

export interface CreateProjectInput {
  companyId?: string | null;
  newCompanyName?: string;
  title?: string;
  subtitle?: string;
  description?: string;
}

// Both "gallery" (photos) and "videos" (film grid) are project/company-scoped
// types — only a plain "images" slideshow has no per-company rows.
async function assertCategoryHoldsProjects(categoryId: string): Promise<void> {
  const category = await getCategoryOrThrow(categoryId);
  if (category.type !== "gallery" && category.type !== "videos") {
    throw new PortfolioValidationError(
      `Category ${categoryId} is type "${category.type}" — projects can only be added to a "gallery" or "videos" category`
    );
  }
}

export async function createProject(
  categoryId: string,
  input: CreateProjectInput
): Promise<PortfolioProject> {
  await assertCategoryHoldsProjects(categoryId);

  let companyId = input.companyId ?? null;
  if (!companyId && input.newCompanyName?.trim()) {
    const created = await findOrCreateCompanyByName(input.newCompanyName);
    companyId = created.id;
  }

  const [existingMax] = await db
    .select({ sortOrder: portfolioProject.sortOrder })
    .from(portfolioProject)
    .where(eq(portfolioProject.categoryId, categoryId))
    .orderBy(asc(portfolioProject.sortOrder))
    .limit(1);
  const nextSortOrder = existingMax ? existingMax.sortOrder + 1 : 0;

  const [row] = await db
    .insert(portfolioProject)
    .values({
      categoryId,
      companyId,
      title: input.title ?? null,
      subtitle: input.subtitle ?? null,
      description: input.description ?? null,
      sortOrder: nextSortOrder,
    })
    .returning();
  if (!row) throw new Error("Failed to create project");
  return row;
}

export interface UpdateProjectInput {
  companyId?: string | null;
  newCompanyName?: string;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput
): Promise<PortfolioProject> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.newCompanyName?.trim()) {
    const created = await findOrCreateCompanyByName(input.newCompanyName);
    patch["companyId"] = created.id;
  } else if ("companyId" in input) {
    patch["companyId"] = input.companyId ?? null;
  }
  if ("title" in input) patch["title"] = input.title ?? null;
  if ("subtitle" in input) patch["subtitle"] = input.subtitle ?? null;
  if ("description" in input) patch["description"] = input.description ?? null;

  const [row] = await db
    .update(portfolioProject)
    .set(patch)
    .where(eq(portfolioProject.id, projectId))
    .returning();
  if (!row) throw new PortfolioNotFoundError("Project not found");
  return row;
}

export async function deleteProject(projectId: string): Promise<void> {
  const rows = await db
    .delete(portfolioProject)
    .where(eq(portfolioProject.id, projectId))
    .returning({ id: portfolioProject.id });
  if (rows.length === 0) throw new PortfolioNotFoundError("Project not found");
}

export async function reorderProjects(categoryId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(portfolioProject)
        .set({ sortOrder: i })
        .where(and(eq(portfolioProject.id, orderedIds[i]!), eq(portfolioProject.categoryId, categoryId)));
    }
  });
}

// ─── Project images ─────────────────────────────────────────────────────────

export async function addProjectImage(projectId: string, url: string, sortOrder = 0) {
  const [row] = await db
    .insert(portfolioProjectImage)
    .values({ projectId, url, sortOrder })
    .returning();
  if (!row) throw new Error("Failed to add project image");
  return row;
}

export async function removeProjectImage(projectId: string, imageId: string): Promise<void> {
  const rows = await db
    .delete(portfolioProjectImage)
    .where(and(eq(portfolioProjectImage.id, imageId), eq(portfolioProjectImage.projectId, projectId)))
    .returning({ id: portfolioProjectImage.id });
  if (rows.length === 0) throw new PortfolioNotFoundError("Project image not found");
}

export async function reorderProjectImages(projectId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(portfolioProjectImage)
        .set({ sortOrder: i })
        .where(and(eq(portfolioProjectImage.id, orderedIds[i]!), eq(portfolioProjectImage.projectId, projectId)));
    }
  });
}

// ─── Project videos ─────────────────────────────────────────────────────────

export async function addProjectVideo(projectId: string, url: string, sortOrder = 0) {
  const [row] = await db
    .insert(portfolioProjectVideo)
    .values({ projectId, url, sortOrder })
    .returning();
  if (!row) throw new Error("Failed to add project video");
  return row;
}

export async function removeProjectVideo(projectId: string, videoId: string): Promise<void> {
  const rows = await db
    .delete(portfolioProjectVideo)
    .where(and(eq(portfolioProjectVideo.id, videoId), eq(portfolioProjectVideo.projectId, projectId)))
    .returning({ id: portfolioProjectVideo.id });
  if (rows.length === 0) throw new PortfolioNotFoundError("Project video not found");
}

export async function reorderProjectVideos(projectId: string, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(portfolioProjectVideo)
        .set({ sortOrder: i })
        .where(and(eq(portfolioProjectVideo.id, orderedIds[i]!), eq(portfolioProjectVideo.projectId, projectId)));
    }
  });
}

// ─── Settings (one row per experience, upsert) ─────────────────────────────────

export async function getOrCreatePortfolioSettings(experienceId: string): Promise<PortfolioSettings> {
  const [existing] = await db
    .select()
    .from(portfolioSettings)
    .where(eq(portfolioSettings.experienceId, experienceId))
    .limit(1);
  if (existing) return existing;

  const [row] = await db.insert(portfolioSettings).values({ experienceId }).returning();
  if (!row) throw new Error("Failed to create portfolio settings");
  return row;
}

export type UpdatePortfolioSettingsInput = Partial<
  Omit<PortfolioSettings, "id" | "experienceId" | "createdAt" | "updatedAt">
>;

export async function updatePortfolioSettings(
  experienceId: string,
  patch: UpdatePortfolioSettingsInput
): Promise<PortfolioSettings> {
  await getOrCreatePortfolioSettings(experienceId);
  const [row] = await db
    .update(portfolioSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(portfolioSettings.experienceId, experienceId))
    .returning();
  if (!row) throw new PortfolioNotFoundError("Settings not found");
  return row;
}
