// Portfolio domain — shared zod schemas + inferred types for the relational
// portfolio template (verticals/categories/projects/companies + settings).
// Used by the API (request validation) and, later, the CMS editor (form
// validation). Companies are global — not scoped to a vertical/category — so
// a project links to one by id or by a brand-new name to create-on-write.

import { z } from "zod";

// ─── Enumerations ─────────────────────────────────────────────────────────────

export const PORTFOLIO_CATEGORY_TYPES = ["images", "videos", "gallery"] as const;
export const portfolioCategoryTypeSchema = z.enum(PORTFOLIO_CATEGORY_TYPES);
export type PortfolioCategoryTypeInput = z.infer<typeof portfolioCategoryTypeSchema>;

/** Only meaningful when a category's type is "gallery" — photo grid vs video grid per company. */
export const PORTFOLIO_GALLERY_KINDS = ["photos", "videos"] as const;
export const portfolioGalleryKindSchema = z.enum(PORTFOLIO_GALLERY_KINDS);
export type PortfolioGalleryKindInput = z.infer<typeof portfolioGalleryKindSchema>;

// ─── Shared helpers ───────────────────────────────────────────────────────────

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

/** Optional free-text field: blank strings normalize to `undefined`. */
function optionalText(max: number) {
  return z.preprocess(emptyToUndefined, z.string().trim().min(1).max(max).optional());
}

/** Nullable free-text field: blank strings normalize to `null` (explicitly clears the column). */
function nullableText(max: number) {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max).nullish()
  );
}

/** Optional id reference: blank strings normalize to `undefined`; `null` clears it. */
const optionalId = z.preprocess(emptyToUndefined, z.string().min(1).nullish());

// ─── Vertical (fixed 3 slots — update only) ────────────────────────────────────

export const updateVerticalSchema = z.object({
  title: z.string().trim().max(200).optional(),
  imageUrl: z.string().trim().max(2000).optional(),
  videoUrl: nullableText(2000),
  description: nullableText(2000),
  button1: z.string().trim().max(60).optional(),
  button2: z.string().trim().max(60).optional(),
});
export type UpdateVerticalInput = z.infer<typeof updateVerticalSchema>;

// ─── Category (fixed 2 slots per vertical — update only, incl. type switch) ───

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  type: portfolioCategoryTypeSchema.optional(),
  galleryKind: portfolioGalleryKindSchema.optional(),
  title: nullableText(200),
  subtitle: nullableText(200),
  description: nullableText(2000),
});
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// ─── Category images / videos ──────────────────────────────────────────────────

export const addCategoryMediaSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  sortOrder: z.number().int().min(0).optional(),
});
export type AddCategoryMediaInput = z.infer<typeof addCategoryMediaSchema>;

export const reorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});
export type ReorderInput = z.infer<typeof reorderSchema>;

// ─── Company ────────────────────────────────────────────────────────────────

export const createCompanySchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

export const updateCompanySchema = createCompanySchema;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const searchCompaniesQuerySchema = z.object({
  search: optionalText(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchCompaniesQuery = z.infer<typeof searchCompaniesQuerySchema>;

// ─── Project (free add/remove/reorder list inside a "gallery" category) ───────

export const createProjectSchema = z.object({
  companyId: optionalId,
  newCompanyName: optionalText(200),
  title: optionalText(200),
  subtitle: optionalText(200),
  description: optionalText(2000),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  companyId: optionalId,
  newCompanyName: optionalText(200),
  title: nullableText(200),
  subtitle: nullableText(200),
  description: nullableText(2000),
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const addProjectImageSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  sortOrder: z.number().int().min(0).optional(),
});
export type AddProjectImageInput = z.infer<typeof addProjectImageSchema>;

export const addProjectVideoSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  sortOrder: z.number().int().min(0).optional(),
});
export type AddProjectVideoInput = z.infer<typeof addProjectVideoSchema>;

// ─── Settings (one row per experience) ─────────────────────────────────────────

export const updatePortfolioSettingsSchema = z
  .object({
    overviewTitleFontSize: z.number().int().min(1).max(400),
    overviewDescriptionFontSize: z.number().int().min(1).max(400),
    overviewButtonFontSize: z.number().int().min(1).max(400),
    overviewCardPadding: z.number().int().min(0).max(400),
    galleryTitleFontSize: z.number().int().min(1).max(400),
    gallerySubtitleFontSize: z.number().int().min(1).max(400),
    galleryDescriptionFontSize: z.number().int().min(1).max(400),
    galleryGap: z.number().int().min(0).max(400),
    galleryPadding: z.number().int().min(0).max(400),
    galleryBackgroundColor: z.string().trim().min(1).max(40),
    galleryTextColor: z.string().trim().min(1).max(40),
    galleryExpandedPct: z.number().int().min(0).max(100),
    galleryBlurPx: z.number().int().min(0).max(200),
  })
  .partial();
export type UpdatePortfolioSettingsInput = z.infer<typeof updatePortfolioSettingsSchema>;
