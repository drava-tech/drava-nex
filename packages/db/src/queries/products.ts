import { eq, and, or, isNull, ilike, asc, count, inArray } from "drizzle-orm";
import type {
  CreateProductInput,
  UpdateProductInput,
  ListProductsQuery,
  ProductMediaInput,
  ProductFeatureInput,
  ProductSpecificationInput,
  ProductDisplayData,
  ProductDisplaySpecGroup,
  ProductMediaRef,
  ProductDetectionLookup,
} from "@platform/types";
import { db } from "../client.js";
import { mediaAsset, type MediaAsset } from "../schema/media.js";
import {
  product,
  productFeature,
  productSpecification,
  productMedia,
  type Product,
  type ProductFeature,
  type ProductSpecification,
  type ProductMedia,
} from "../schema/products.js";

/**
 * Product data access — the single source of truth for the product catalogue.
 * The Hono API and seed scripts call these; the CMS reaches them only over HTTP.
 */

// ─── Errors ───────────────────────────────────────────────────────────────────

/** Thrown when a product (or a child scoped to a product) does not exist. */
export class ProductNotFoundError extends Error {
  constructor(message = "Product not found") {
    super(message);
    this.name = "ProductNotFoundError";
  }
}

// ─── List ─────────────────────────────────────────────────────────────────────

export interface ProductListItem {
  id: string;
  name: string;
  slug: string;
  sku: string | null;
  category: string | null;
  detectionLabel: string | null;
  status: Product["status"];
  thumbnailUrl: string | null;
  updatedAt: Date;
}

export interface ProductListResult {
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listProducts(query: ListProductsQuery): Promise<ProductListResult> {
  const { page, pageSize, search, category, status } = query;

  const filters = [isNull(product.deletedAt)];
  if (status) filters.push(eq(product.status, status));
  if (category) filters.push(eq(product.category, category));
  if (search) {
    const term = `%${search}%`;
    const match = or(
      ilike(product.name, term),
      ilike(product.sku, term),
      ilike(product.category, term),
      ilike(product.detectionLabel, term)
    );
    if (match) filters.push(match);
  }
  const where = and(...filters);

  const totalRows = await db
    .select({ total: count() })
    .from(product)
    .where(where);
  const total = totalRows[0]?.total ?? 0;

  const rows = await db
    .select({
      id: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      category: product.category,
      detectionLabel: product.detectionLabel,
      status: product.status,
      updatedAt: product.updatedAt,
      thumbnailUrl: mediaAsset.url,
    })
    .from(product)
    .leftJoin(
      mediaAsset,
      and(eq(product.thumbnailMediaId, mediaAsset.id), isNull(mediaAsset.deletedAt))
    )
    .where(where)
    .orderBy(asc(product.name))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return {
    items: rows.map((r) => ({ ...r })),
    total,
    page,
    pageSize,
  };
}

// ─── Admin detail (full row + children for the edit form) ─────────────────────

export interface ProductDetail extends Product {
  thumbnailUrl: string | null;
  heroUrl: string | null;
  demoVideoUrl: string | null;
  features: ProductFeature[];
  specifications: ProductSpecification[];
  media: (ProductMedia & { url: string | null; name: string | null })[];
}

async function getProductRow(id: string): Promise<Product | null> {
  const [row] = await db
    .select()
    .from(product)
    .where(and(eq(product.id, id), isNull(product.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getProductDetail(id: string): Promise<ProductDetail | null> {
  const row = await getProductRow(id);
  if (!row) return null;

  const directIds = [row.thumbnailMediaId, row.heroMediaId, row.demoVideoMediaId].filter(
    (x): x is string => Boolean(x)
  );

  const [features, specifications, media, directMedia] = await Promise.all([
    db
      .select()
      .from(productFeature)
      .where(eq(productFeature.productId, id))
      .orderBy(asc(productFeature.sortOrder), asc(productFeature.createdAt)),
    db
      .select()
      .from(productSpecification)
      .where(eq(productSpecification.productId, id))
      .orderBy(asc(productSpecification.sortOrder), asc(productSpecification.createdAt)),
    db
      .select({
        id: productMedia.id,
        productId: productMedia.productId,
        mediaId: productMedia.mediaId,
        mediaType: productMedia.mediaType,
        purpose: productMedia.purpose,
        altText: productMedia.altText,
        sortOrder: productMedia.sortOrder,
        createdAt: productMedia.createdAt,
        url: mediaAsset.url,
        name: mediaAsset.name,
      })
      .from(productMedia)
      .leftJoin(mediaAsset, eq(productMedia.mediaId, mediaAsset.id))
      .where(eq(productMedia.productId, id))
      .orderBy(asc(productMedia.sortOrder), asc(productMedia.createdAt)),
    directIds.length
      ? db
          .select({ id: mediaAsset.id, url: mediaAsset.url })
          .from(mediaAsset)
          .where(and(inArray(mediaAsset.id, directIds), isNull(mediaAsset.deletedAt)))
      : Promise.resolve([] as { id: string; url: string }[]),
  ]);

  const urlById = new Map(directMedia.map((m) => [m.id, m.url]));

  return {
    ...row,
    thumbnailUrl: row.thumbnailMediaId ? urlById.get(row.thumbnailMediaId) ?? null : null,
    heroUrl: row.heroMediaId ? urlById.get(row.heroMediaId) ?? null : null,
    demoVideoUrl: row.demoVideoMediaId ? urlById.get(row.demoVideoMediaId) ?? null : null,
    features,
    specifications,
    media,
  };
}

// ─── Display payload (public, ACTIVE-only handled by caller) ──────────────────

function toMediaRef(asset: Pick<MediaAsset, "id" | "url" | "type"> | undefined, altText: string | null): ProductMediaRef | null {
  if (!asset) return null;
  return { id: asset.id, url: asset.url, type: asset.type, altText };
}

/**
 * Assemble the public display payload. Returns null only when the product does
 * not exist (or is soft-deleted). The caller checks `status` to decide between
 * the "unavailable" (inactive) and normal render.
 */
export async function getProductDisplayData(id: string): Promise<ProductDisplayData | null> {
  const row = await getProductRow(id);
  if (!row) return null;

  const directMediaIds = [row.thumbnailMediaId, row.heroMediaId, row.demoVideoMediaId].filter(
    (x): x is string => Boolean(x)
  );

  const [directMedia, features, specs, gallery] = await Promise.all([
    directMediaIds.length
      ? db
          .select({ id: mediaAsset.id, url: mediaAsset.url, type: mediaAsset.type })
          .from(mediaAsset)
          .where(and(inArray(mediaAsset.id, directMediaIds), isNull(mediaAsset.deletedAt)))
      : Promise.resolve([] as { id: string; url: string; type: string }[]),
    db
      .select()
      .from(productFeature)
      .where(eq(productFeature.productId, id))
      .orderBy(asc(productFeature.sortOrder), asc(productFeature.createdAt)),
    db
      .select()
      .from(productSpecification)
      .where(eq(productSpecification.productId, id))
      .orderBy(asc(productSpecification.sortOrder), asc(productSpecification.createdAt)),
    db
      .select({
        id: mediaAsset.id,
        url: mediaAsset.url,
        type: mediaAsset.type,
        altText: productMedia.altText,
      })
      .from(productMedia)
      .innerJoin(
        mediaAsset,
        and(eq(productMedia.mediaId, mediaAsset.id), isNull(mediaAsset.deletedAt))
      )
      .where(and(eq(productMedia.productId, id), eq(productMedia.purpose, "GALLERY")))
      .orderBy(asc(productMedia.sortOrder), asc(productMedia.createdAt)),
  ]);

  const mediaById = new Map(directMedia.map((m) => [m.id, m]));

  // Group specifications, preserving the order groups first appear in.
  const groups: ProductDisplaySpecGroup[] = [];
  const groupIndex = new Map<string, number>();
  for (const s of specs) {
    let idx = groupIndex.get(s.groupName);
    if (idx === undefined) {
      idx = groups.length;
      groupIndex.set(s.groupName, idx);
      groups.push({ name: s.groupName, items: [] });
    }
    groups[idx]!.items.push({
      id: s.id,
      label: s.label,
      value: s.value,
      unit: s.unit,
      sortOrder: s.sortOrder,
    });
  }

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    sku: row.sku,
    detectionLabel: row.detectionLabel,
    category: row.category,
    brand: row.brand,
    shortDescription: row.shortDescription,
    fullDescription: row.fullDescription,
    status: row.status,
    thumbnail: toMediaRef(row.thumbnailMediaId ? mediaById.get(row.thumbnailMediaId) : undefined, null),
    hero: toMediaRef(row.heroMediaId ? mediaById.get(row.heroMediaId) : undefined, null),
    video: toMediaRef(row.demoVideoMediaId ? mediaById.get(row.demoVideoMediaId) : undefined, null),
    gallery: gallery.map((g) => ({ id: g.id, url: g.url, type: g.type, altText: g.altText })),
    features: features.map((f) => ({
      id: f.id,
      title: f.title,
      description: f.description,
      sortOrder: f.sortOrder,
    })),
    specificationGroups: groups,
  };
}

// ─── Detection-label lookup (public, ACTIVE-only) ─────────────────────────────

export async function getProductByDetectionLabel(
  detectionLabel: string
): Promise<ProductDetectionLookup | null> {
  const [row] = await db
    .select({
      productId: product.id,
      name: product.name,
      detectionLabel: product.detectionLabel,
      status: product.status,
    })
    .from(product)
    .where(
      and(
        eq(product.detectionLabel, detectionLabel),
        eq(product.status, "ACTIVE"),
        isNull(product.deletedAt)
      )
    )
    .limit(1);

  if (!row || !row.detectionLabel) return null;
  return {
    productId: row.productId,
    name: row.name,
    detectionLabel: row.detectionLabel,
    status: row.status,
  };
}

/** Batch form of getProductByDetectionLabel — one query for a mat's whole inventory. */
export async function getProductsByDetectionLabels(
  detectionLabels: string[]
): Promise<ProductDetectionLookup[]> {
  if (detectionLabels.length === 0) return [];

  const rows = await db
    .select({
      productId: product.id,
      name: product.name,
      detectionLabel: product.detectionLabel,
      status: product.status,
    })
    .from(product)
    .where(
      and(
        inArray(product.detectionLabel, detectionLabels),
        eq(product.status, "ACTIVE"),
        isNull(product.deletedAt)
      )
    );

  const results: ProductDetectionLookup[] = [];
  for (const row of rows) {
    if (!row.detectionLabel) continue;
    results.push({
      productId: row.productId,
      name: row.name,
      detectionLabel: row.detectionLabel,
      status: row.status,
    });
  }
  return results;
}

// ─── Create / update / archive ────────────────────────────────────────────────

export async function createProduct(
  input: CreateProductInput,
  createdByUserId: string | null
): Promise<Product> {
  const [row] = await db
    .insert(product)
    .values({
      name: input.name,
      slug: input.slug,
      sku: input.sku ?? null,
      detectionLabel: input.detectionLabel ?? null,
      category: input.category ?? null,
      brand: input.brand ?? null,
      shortDescription: input.shortDescription ?? null,
      fullDescription: input.fullDescription ?? null,
      status: input.status,
      thumbnailMediaId: input.thumbnailMediaId ?? null,
      heroMediaId: input.heroMediaId ?? null,
      demoVideoMediaId: input.demoVideoMediaId ?? null,
      metadata: input.metadata ?? null,
      createdByUserId,
    })
    .returning();
  if (!row) throw new Error("Failed to create product");
  return row;
}

export async function updateProduct(id: string, input: UpdateProductInput): Promise<Product> {
  const existing = await getProductRow(id);
  if (!existing) throw new ProductNotFoundError();

  // Only set keys explicitly provided, so partial updates don't clear fields.
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  const assign = (key: keyof UpdateProductInput, column: string) => {
    if (key in input) patch[column] = (input as Record<string, unknown>)[key] ?? null;
  };
  assign("name", "name");
  assign("slug", "slug");
  assign("sku", "sku");
  assign("detectionLabel", "detectionLabel");
  assign("category", "category");
  assign("brand", "brand");
  assign("shortDescription", "shortDescription");
  assign("fullDescription", "fullDescription");
  assign("status", "status");
  assign("thumbnailMediaId", "thumbnailMediaId");
  assign("heroMediaId", "heroMediaId");
  assign("demoVideoMediaId", "demoVideoMediaId");
  assign("metadata", "metadata");
  // `status` must never become null.
  if (patch["status"] === null) delete patch["status"];

  const [row] = await db.update(product).set(patch).where(eq(product.id, id)).returning();
  if (!row) throw new ProductNotFoundError();
  return row;
}

/** Soft-delete (non-destructive). The row and its children are preserved. */
export async function softDeleteProduct(id: string): Promise<void> {
  const existing = await getProductRow(id);
  if (!existing) throw new ProductNotFoundError();
  await db
    .update(product)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(product.id, id));
}

// ─── Features ─────────────────────────────────────────────────────────────────

async function assertProductExists(productId: string): Promise<void> {
  const row = await getProductRow(productId);
  if (!row) throw new ProductNotFoundError();
}

export async function addProductFeature(
  productId: string,
  input: ProductFeatureInput
): Promise<ProductFeature> {
  await assertProductExists(productId);
  const [row] = await db
    .insert(productFeature)
    .values({
      productId,
      title: input.title,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  if (!row) throw new Error("Failed to create feature");
  return row;
}

export async function updateProductFeature(
  productId: string,
  featureId: string,
  input: Partial<ProductFeatureInput>
): Promise<ProductFeature> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if ("title" in input) patch["title"] = input.title;
  if ("description" in input) patch["description"] = input.description ?? null;
  if ("sortOrder" in input) patch["sortOrder"] = input.sortOrder ?? 0;

  const [row] = await db
    .update(productFeature)
    .set(patch)
    .where(and(eq(productFeature.id, featureId), eq(productFeature.productId, productId)))
    .returning();
  if (!row) throw new ProductNotFoundError("Feature not found");
  return row;
}

export async function deleteProductFeature(productId: string, featureId: string): Promise<void> {
  const rows = await db
    .delete(productFeature)
    .where(and(eq(productFeature.id, featureId), eq(productFeature.productId, productId)))
    .returning({ id: productFeature.id });
  if (rows.length === 0) throw new ProductNotFoundError("Feature not found");
}

// ─── Specifications ───────────────────────────────────────────────────────────

export async function addProductSpecification(
  productId: string,
  input: ProductSpecificationInput
): Promise<ProductSpecification> {
  await assertProductExists(productId);
  const [row] = await db
    .insert(productSpecification)
    .values({
      productId,
      groupName: input.groupName,
      label: input.label,
      value: input.value,
      unit: input.unit ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  if (!row) throw new Error("Failed to create specification");
  return row;
}

export async function updateProductSpecification(
  productId: string,
  specificationId: string,
  input: Partial<ProductSpecificationInput>
): Promise<ProductSpecification> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if ("groupName" in input) patch["groupName"] = input.groupName;
  if ("label" in input) patch["label"] = input.label;
  if ("value" in input) patch["value"] = input.value;
  if ("unit" in input) patch["unit"] = input.unit ?? null;
  if ("sortOrder" in input) patch["sortOrder"] = input.sortOrder ?? 0;

  const [row] = await db
    .update(productSpecification)
    .set(patch)
    .where(
      and(
        eq(productSpecification.id, specificationId),
        eq(productSpecification.productId, productId)
      )
    )
    .returning();
  if (!row) throw new ProductNotFoundError("Specification not found");
  return row;
}

export async function deleteProductSpecification(
  productId: string,
  specificationId: string
): Promise<void> {
  const rows = await db
    .delete(productSpecification)
    .where(
      and(
        eq(productSpecification.id, specificationId),
        eq(productSpecification.productId, productId)
      )
    )
    .returning({ id: productSpecification.id });
  if (rows.length === 0) throw new ProductNotFoundError("Specification not found");
}

// ─── Media links ──────────────────────────────────────────────────────────────

/**
 * Link a media-library asset to a product. Re-linking the same asset for the
 * same purpose updates its alt text / order instead of erroring (idempotent),
 * and never duplicates the relation thanks to the unique index.
 */
export async function addProductMedia(
  productId: string,
  input: ProductMediaInput
): Promise<ProductMedia> {
  await assertProductExists(productId);

  const [asset] = await db
    .select({ id: mediaAsset.id, type: mediaAsset.type })
    .from(mediaAsset)
    .where(and(eq(mediaAsset.id, input.mediaId), isNull(mediaAsset.deletedAt)))
    .limit(1);
  if (!asset) throw new ProductNotFoundError("Media asset not found");

  const [row] = await db
    .insert(productMedia)
    .values({
      productId,
      mediaId: input.mediaId,
      mediaType: asset.type,
      purpose: input.purpose,
      altText: input.altText ?? null,
      sortOrder: input.sortOrder ?? 0,
    })
    .onConflictDoUpdate({
      target: [productMedia.productId, productMedia.mediaId, productMedia.purpose],
      set: { altText: input.altText ?? null, sortOrder: input.sortOrder ?? 0 },
    })
    .returning();
  if (!row) throw new Error("Failed to link media");
  return row;
}

/** Remove a product↔media link. The underlying media asset is left untouched. */
export async function removeProductMedia(
  productId: string,
  productMediaId: string
): Promise<void> {
  const rows = await db
    .delete(productMedia)
    .where(and(eq(productMedia.id, productMediaId), eq(productMedia.productId, productId)))
    .returning({ id: productMedia.id });
  if (rows.length === 0) throw new ProductNotFoundError("Product media not found");
}
