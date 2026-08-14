import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { experience } from "./projects.js";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const portfolioCategoryTypeEnum = pgEnum("portfolio_category_type", [
  "images",
  "videos",
  "gallery",
]);

/** Only meaningful when portfolio_category.type = 'gallery' — decides whether
 *  that category's company pages render the photo grid or the video grid. */
export const portfolioGalleryKindEnum = pgEnum("portfolio_gallery_kind", [
  "photos",
  "videos",
]);

// ─── Portfolio Vertical (was OverviewCard) ─────────────────────────────────────

/**
 * Exactly 3 per portfolio experience (slotIndex 0-2) — matches OverviewView's
 * hard-coded 3-column grid. Never added/removed/reordered by the app layer,
 * only updated in place.
 */
export const portfolioVertical = pgTable(
  "portfolio_vertical",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    experienceId: text("experience_id")
      .notNull()
      .references(() => experience.id, { onDelete: "cascade" }),
    slotIndex: integer("slot_index").notNull(),
    title: text("title").notNull().default(""),
    imageUrl: text("image_url").notNull().default(""),
    videoUrl: text("video_url"),
    description: text("description"),
    button1: text("button1").notNull().default("Watch Video"),
    button2: text("button2").notNull().default("Projects"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("portfolio_vertical_experience_slot_idx").on(
      table.experienceId,
      table.slotIndex
    ),
    index("portfolio_vertical_experience_idx").on(table.experienceId),
  ]
);

export type PortfolioVertical = typeof portfolioVertical.$inferSelect;
export type NewPortfolioVertical = typeof portfolioVertical.$inferInsert;

// ─── Portfolio Category (was PortfolioSection) ─────────────────────────────────

/**
 * Exactly 2 per vertical (slotIndex 0-1) — matches SplitView's binary
 * left/right divider. title/subtitle/description are kept regardless of
 * `type` so switching a category's type never discards its gallery copy.
 */
export const portfolioCategory = pgTable(
  "portfolio_category",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    verticalId: text("vertical_id")
      .notNull()
      .references(() => portfolioVertical.id, { onDelete: "cascade" }),
    slotIndex: integer("slot_index").notNull(),
    name: text("name").notNull(),
    type: portfolioCategoryTypeEnum("type").notNull().default("images"),
    // Only meaningful when type = 'gallery' — photo grid vs video grid per company.
    galleryKind: portfolioGalleryKindEnum("gallery_kind").notNull().default("photos"),
    title: text("title"),
    subtitle: text("subtitle"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("portfolio_category_vertical_slot_idx").on(
      table.verticalId,
      table.slotIndex
    ),
    index("portfolio_category_vertical_idx").on(table.verticalId),
  ]
);

export type PortfolioCategory = typeof portfolioCategory.$inferSelect;
export type NewPortfolioCategory = typeof portfolioCategory.$inferInsert;

// ─── Category Images / Videos (type: "images" | "videos") ─────────────────────

export const portfolioCategoryImage = pgTable(
  "portfolio_category_image",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    categoryId: text("category_id")
      .notNull()
      .references(() => portfolioCategory.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("portfolio_category_image_category_idx").on(table.categoryId)]
);

export type PortfolioCategoryImage = typeof portfolioCategoryImage.$inferSelect;
export type NewPortfolioCategoryImage = typeof portfolioCategoryImage.$inferInsert;

export const portfolioCategoryVideo = pgTable(
  "portfolio_category_video",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    categoryId: text("category_id")
      .notNull()
      .references(() => portfolioCategory.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("portfolio_category_video_category_idx").on(table.categoryId)]
);

export type PortfolioCategoryVideo = typeof portfolioCategoryVideo.$inferSelect;
export type NewPortfolioCategoryVideo = typeof portfolioCategoryVideo.$inferInsert;

// ─── Company (global — shared across every vertical/category) ─────────────────

/**
 * One row per real-world company, reused wherever it has project work in the
 * portfolio. Not scoped to an experience/vertical/category — that's what
 * makes "all projects for Company X" a single indexed query.
 */
export const company = pgTable(
  "company",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("company_slug_unique_idx")
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    index("company_deleted_at_idx").on(table.deletedAt),
    index("company_name_idx").on(table.name),
  ]
);

export type Company = typeof company.$inferSelect;
export type NewCompany = typeof company.$inferInsert;

// ─── Portfolio Project (was PortfolioProject — company's work in a category) ──

/**
 * A free, add/remove/reorder list scoped to one `type: "gallery"` category.
 * `companyId` is nullable/`set null` — unlinking or deleting a company must
 * never delete the project's own copy and photos, matching today's
 * "blank company" case.
 */
export const portfolioProject = pgTable(
  "portfolio_project",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    categoryId: text("category_id")
      .notNull()
      .references(() => portfolioCategory.id, { onDelete: "cascade" }),
    companyId: text("company_id").references(() => company.id, {
      onDelete: "set null",
    }),
    title: text("title"),
    subtitle: text("subtitle"),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("portfolio_project_category_idx").on(table.categoryId),
    index("portfolio_project_company_idx").on(table.companyId),
  ]
);

export type PortfolioProject = typeof portfolioProject.$inferSelect;
export type NewPortfolioProject = typeof portfolioProject.$inferInsert;

// ─── Portfolio Project Image ───────────────────────────────────────────────────

export const portfolioProjectImage = pgTable(
  "portfolio_project_image",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    projectId: text("project_id")
      .notNull()
      .references(() => portfolioProject.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("portfolio_project_image_project_idx").on(table.projectId)]
);

export type PortfolioProjectImage = typeof portfolioProjectImage.$inferSelect;
export type NewPortfolioProjectImage = typeof portfolioProjectImage.$inferInsert;

// ─── Portfolio Project Video ───────────────────────────────────────────────────

/** A project can hold multiple videos — e.g. a company's Brand Films page. */
export const portfolioProjectVideo = pgTable(
  "portfolio_project_video",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    projectId: text("project_id")
      .notNull()
      .references(() => portfolioProject.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("portfolio_project_video_project_idx").on(table.projectId)]
);

export type PortfolioProjectVideo = typeof portfolioProjectVideo.$inferSelect;
export type NewPortfolioProjectVideo = typeof portfolioProjectVideo.$inferInsert;

// ─── Portfolio Settings (one row per experience — style/config fields) ────────

export const portfolioSettings = pgTable(
  "portfolio_settings",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    experienceId: text("experience_id")
      .notNull()
      .references(() => experience.id, { onDelete: "cascade" }),
    overviewTitleFontSize: integer("overview_title_font_size").notNull().default(50),
    overviewDescriptionFontSize: integer("overview_description_font_size")
      .notNull()
      .default(22),
    overviewButtonFontSize: integer("overview_button_font_size").notNull().default(20),
    overviewCardPadding: integer("overview_card_padding").notNull().default(44),
    galleryTitleFontSize: integer("gallery_title_font_size").notNull().default(64),
    gallerySubtitleFontSize: integer("gallery_subtitle_font_size").notNull().default(24),
    galleryDescriptionFontSize: integer("gallery_description_font_size")
      .notNull()
      .default(20),
    galleryGap: integer("gallery_gap").notNull().default(26),
    galleryPadding: integer("gallery_padding").notNull().default(78),
    galleryBackgroundColor: text("gallery_background_color").notNull().default("#e8e8f7"),
    galleryTextColor: text("gallery_text_color").notNull().default("#111114"),
    galleryExpandedPct: integer("gallery_expanded_pct").notNull().default(70),
    galleryBlurPx: integer("gallery_blur_px").notNull().default(12),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("portfolio_settings_experience_unique_idx").on(table.experienceId),
  ]
);

export type PortfolioSettings = typeof portfolioSettings.$inferSelect;
export type NewPortfolioSettings = typeof portfolioSettings.$inferInsert;
