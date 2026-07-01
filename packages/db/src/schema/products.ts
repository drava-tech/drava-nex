import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { user } from "./auth.js";
import { mediaAsset } from "./media.js";

// ─── Enums ────────────────────────────────────────────────────────────────────

export const productStatusEnum = pgEnum("product_status", [
  "DRAFT",
  "ACTIVE",
  "INACTIVE",
  "ARCHIVED",
]);

export const productMediaPurposeEnum = pgEnum("product_media_purpose", [
  "THUMBNAIL",
  "HERO",
  "GALLERY",
  "VIDEO",
  "BROCHURE",
  "DOCUMENT",
  "MODEL_3D",
]);

// ─── Product ──────────────────────────────────────────────────────────────────

/**
 * A catalogue product. `detectionLabel` is the machine-friendly key a future
 * vision model returns; the CMS maps it to this row. Product content (copy,
 * media, specs) lives here and is fetched by the Product Showcase template at
 * render time — never hard-coded downstream.
 */
export const product = pgTable(
  "product",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    sku: text("sku"),
    // Machine-friendly vision-model class name (e.g. "smart_glasses").
    detectionLabel: text("detection_label"),
    category: text("category"),
    brand: text("brand"),
    shortDescription: text("short_description"),
    fullDescription: text("full_description"),
    status: productStatusEnum("status").notNull().default("DRAFT"),
    thumbnailMediaId: text("thumbnail_media_id").references(() => mediaAsset.id, {
      onDelete: "set null",
    }),
    heroMediaId: text("hero_media_id").references(() => mediaAsset.id, {
      onDelete: "set null",
    }),
    demoVideoMediaId: text("demo_video_media_id").references(() => mediaAsset.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // Unique while not soft-deleted; sku/detectionLabel only enforced when present.
    uniqueIndex("product_slug_unique_idx")
      .on(table.slug)
      .where(sql`${table.deletedAt} IS NULL`),
    uniqueIndex("product_sku_unique_idx")
      .on(table.sku)
      .where(sql`${table.deletedAt} IS NULL AND ${table.sku} IS NOT NULL`),
    uniqueIndex("product_detection_label_unique_idx")
      .on(table.detectionLabel)
      .where(sql`${table.deletedAt} IS NULL AND ${table.detectionLabel} IS NOT NULL`),
    index("product_status_idx").on(table.status),
    index("product_category_idx").on(table.category),
    index("product_deleted_at_idx").on(table.deletedAt),
  ]
);

export type Product = typeof product.$inferSelect;
export type NewProduct = typeof product.$inferInsert;

// ─── Product Feature ──────────────────────────────────────────────────────────

export const productFeature = pgTable(
  "product_feature",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("product_feature_product_idx").on(table.productId)]
);

export type ProductFeature = typeof productFeature.$inferSelect;
export type NewProductFeature = typeof productFeature.$inferInsert;

// ─── Product Specification ────────────────────────────────────────────────────

export const productSpecification = pgTable(
  "product_specification",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    groupName: text("group_name").notNull(),
    label: text("label").notNull(),
    value: text("value").notNull(),
    unit: text("unit"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("product_specification_product_idx").on(table.productId)]
);

export type ProductSpecification = typeof productSpecification.$inferSelect;
export type NewProductSpecification = typeof productSpecification.$inferInsert;

// ─── Product Media (relation to the existing media library) ───────────────────

export const productMedia = pgTable(
  "product_media",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    // Removing a product↔media link must never delete the underlying asset's
    // history; the media library owns the file. Cascade only drops the link row
    // when the asset itself is hard-deleted (assets are soft-deleted in practice).
    mediaId: text("media_id")
      .notNull()
      .references(() => mediaAsset.id, { onDelete: "cascade" }),
    mediaType: text("media_type").notNull(),
    purpose: productMediaPurposeEnum("purpose").notNull(),
    altText: text("alt_text"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Prevent duplicate links of the same asset for the same purpose.
    uniqueIndex("product_media_unique_idx").on(
      table.productId,
      table.mediaId,
      table.purpose
    ),
    index("product_media_product_idx").on(table.productId),
  ]
);

export type ProductMedia = typeof productMedia.$inferSelect;
export type NewProductMedia = typeof productMedia.$inferInsert;
