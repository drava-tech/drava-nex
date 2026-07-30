// Product domain — shared zod schemas + inferred types.
// Used by the API (request validation) and the CMS (form validation), and the
// display/UI packages (response typing). Keep this the single source of truth
// for the product contract so camera detection can be added later without drift.

import { z } from "zod";

// ─── Enumerations ─────────────────────────────────────────────────────────────

export const PRODUCT_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const;
export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof productStatusSchema>;

export const PRODUCT_MEDIA_PURPOSES = [
  "THUMBNAIL",
  "HERO",
  "GALLERY",
  "VIDEO",
  "BROCHURE",
  "DOCUMENT",
  "MODEL_3D",
] as const;
export const productMediaPurposeSchema = z.enum(PRODUCT_MEDIA_PURPOSES);
export type ProductMediaPurpose = z.infer<typeof productMediaPurposeSchema>;

// ─── Field schemas ────────────────────────────────────────────────────────────

/**
 * Machine-friendly detection label: lowercase letters, digits and underscores
 * only — no spaces or special symbols. This must match the vision model class
 * name (e.g. "smart_glasses", "vr_headset").
 */
export const detectionLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[a-z0-9_]+$/,
    "Use lowercase letters, numbers and underscores only (no spaces or symbols)."
  );

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(140)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers and single hyphens (e.g. smart-glasses)."
  );

const emptyToUndefined = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

/** Optional free-text field: blank strings normalize to `undefined`. */
function optionalText(max: number) {
  return z.preprocess(emptyToUndefined, z.string().trim().min(1).max(max).optional());
}

/** Optional id reference: blank strings normalize to `undefined`; `null` clears it. */
const optionalMediaId = z.preprocess(
  emptyToUndefined,
  z.string().min(1).nullish()
);

// ─── Nested write schemas ─────────────────────────────────────────────────────

export const productFeatureInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  sortOrder: z.number().int().min(0).optional(),
});
export type ProductFeatureInput = z.infer<typeof productFeatureInputSchema>;

export const productSpecificationInputSchema = z.object({
  groupName: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(160),
  value: z.string().trim().min(1).max(500),
  unit: optionalText(40),
  sortOrder: z.number().int().min(0).optional(),
});
export type ProductSpecificationInput = z.infer<typeof productSpecificationInputSchema>;

export const productMediaInputSchema = z.object({
  mediaId: z.string().min(1),
  purpose: productMediaPurposeSchema,
  altText: optionalText(300),
  sortOrder: z.number().int().min(0).optional(),
});
export type ProductMediaInput = z.infer<typeof productMediaInputSchema>;

// ─── Product write schemas ────────────────────────────────────────────────────

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema,
  sku: optionalText(80),
  detectionLabel: z.preprocess(emptyToUndefined, detectionLabelSchema.optional()),
  category: optionalText(120),
  brand: optionalText(120),
  shortDescription: optionalText(500),
  fullDescription: optionalText(10000),
  status: productStatusSchema.default("DRAFT"),
  thumbnailMediaId: optionalMediaId,
  heroMediaId: optionalMediaId,
  demoVideoMediaId: optionalMediaId,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: optionalText(200),
  category: optionalText(120),
  status: productStatusSchema.optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

// ─── Detection event contract (future camera integration) ─────────────────────
// Defined now so the lookup service + types are ready; NOT emitted by the gateway
// yet. A camera service will produce these and the CMS will resolve label→product.

export const productDetectedEventSchema = z.object({
  type: z.literal("PRODUCT_DETECTED"),
  cameraId: z.string().min(1),
  label: detectionLabelSchema,
  confidence: z.number().min(0).max(1),
  detectedAt: z.string().min(1),
});
export type ProductDetectedEvent = z.infer<typeof productDetectedEventSchema>;

// Emitted when a product that was previously detected is no longer in frame.
export const productLostEventSchema = z.object({
  type: z.literal("PRODUCT_LOST"),
  cameraId: z.string().min(1),
  label: detectionLabelSchema,
  lostAt: z.string().min(1),
});
export type ProductLostEvent = z.infer<typeof productLostEventSchema>;

// Emitted by the gateway to screens instructing them to display a specific product.
export const displayProductEventSchema = z.object({
  type: z.literal("DISPLAY_PRODUCT"),
  productId: z.string().min(1),
  label: detectionLabelSchema,
  confidence: z.number().min(0).max(1),
  triggeredAt: z.string().min(1),
});
export type DisplayProductEvent = z.infer<typeof displayProductEventSchema>;

// ─── Mat inventory (multi-item detection) ──────────────────────────────────
// Emitted by services/vision's OBJECT worker (see workers/object.py) via the
// internal event relay — the full current mix of products on a mat/table at
// once, not a single best guess. Distinct from productDetectedEventSchema
// above (single-item, browser-camera pipeline) which this does not replace.

export const matInventoryItemSchema = z.object({
  detectionLabel: detectionLabelSchema,
  count: z.number().int().min(1),
});
export type MatInventoryItem = z.infer<typeof matInventoryItemSchema>;

export const inventoryUpdateEventSchema = z.object({
  type: z.literal("INVENTORY_UPDATE"),
  cameraId: z.string().min(1),
  items: z.array(matInventoryItemSchema),
  detectedAt: z.string().min(1),
});
export type InventoryUpdateEvent = z.infer<typeof inventoryUpdateEventSchema>;

/** A resolved mat-inventory item, ready for display (label -> catalogue product). */
export interface MatInventoryDisplayItem {
  productId: string;
  name: string;
  detectionLabel: string;
  count: number;
}


// ─── Display/response types ───────────────────────────────────────────────────
// The shape returned by GET /api/products/:id/display and consumed by the
// Product Showcase template. No product content is ever hard-coded downstream.

export interface ProductMediaRef {
  id: string;
  url: string;
  altText: string | null;
  type: string;
}

export interface ProductDisplayFeature {
  id: string;
  title: string;
  description: string | null;
  sortOrder: number;
}

export interface ProductDisplaySpecItem {
  id: string;
  label: string;
  value: string;
  unit: string | null;
  sortOrder: number;
}

export interface ProductDisplaySpecGroup {
  name: string;
  items: ProductDisplaySpecItem[];
}

export interface ProductDisplayData {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  detectionLabel: string | null;
  category: string | null;
  brand: string | null;
  shortDescription: string | null;
  fullDescription: string | null;
  status: ProductStatus;
  thumbnail: ProductMediaRef | null;
  hero: ProductMediaRef | null;
  video: ProductMediaRef | null;
  gallery: ProductMediaRef[];
  features: ProductDisplayFeature[];
  specificationGroups: ProductDisplaySpecGroup[];
}

/** Minimal payload for the detection-label lookup endpoint. */
export interface ProductDetectionLookup {
  productId: string;
  name: string;
  detectionLabel: string;
  status: ProductStatus;
}

// ─── Validation helpers ───────────────────────────────────────────────────────

export interface FieldError {
  field: string;
  message: string;
}

/** Flatten a ZodError into a simple field/message list for API + form display. */
export function formatZodError(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}
