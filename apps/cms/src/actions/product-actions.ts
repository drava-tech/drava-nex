"use server";

import { revalidatePath } from "next/cache";
import type {
  CreateProductInput,
  UpdateProductInput,
  ProductFeatureInput,
  ProductSpecificationInput,
  ProductMediaInput,
  ListProductsQuery,
  FieldError,
  ProductDisplayData,
} from "@platform/types";
import type { ProductListResult } from "@platform/db";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  apiCreateProduct,
  apiUpdateProduct,
  apiDeleteProduct,
  apiAddFeature,
  apiUpdateFeature,
  apiDeleteFeature,
  apiAddSpecification,
  apiUpdateSpecification,
  apiDeleteSpecification,
  apiAddMedia,
  apiRemoveMedia,
  fetchProducts,
  fetchProductDisplay,
  type ApiResult,
} from "@/lib/products-api";

/**
 * Thin server actions over the Hono product API. They add the admin guard +
 * cache revalidation and translate API results into a form-friendly shape. No
 * product business logic lives here — the API owns it.
 */

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  fieldErrors?: FieldError[];
}

function toActionResult<T>(res: ApiResult<T>): ActionResult<T> {
  if (res.ok) return { success: true, data: res.data };
  const fieldErrors = Array.isArray(res.error.details)
    ? (res.error.details as FieldError[])
    : undefined;
  return { success: false, error: res.error.message, code: res.error.code, fieldErrors };
}

function revalidateProduct(productId?: string) {
  revalidatePath("/products");
  if (productId) revalidatePath(`/products/${productId}/edit`);
}

// ─── Product ──────────────────────────────────────────────────────────────────

export async function createProductAction(
  input: CreateProductInput
): Promise<ActionResult<{ id: string }>> {
  await requireAdmin();
  const res = await apiCreateProduct(input);
  if (!res.ok) return toActionResult(res);
  revalidateProduct(res.data.id);
  return { success: true, data: { id: res.data.id } };
}

export async function updateProductAction(
  productId: string,
  input: UpdateProductInput
): Promise<ActionResult> {
  await requireAdmin();
  const res = await apiUpdateProduct(productId, input);
  if (res.ok) revalidateProduct(productId);
  return toActionResult(res);
}

export async function deleteProductAction(productId: string): Promise<ActionResult> {
  await requireAdmin();
  const res = await apiDeleteProduct(productId);
  if (res.ok) revalidateProduct(productId);
  return toActionResult(res);
}

// ─── Features ─────────────────────────────────────────────────────────────────

export async function addFeatureAction(
  productId: string,
  input: ProductFeatureInput
): Promise<ActionResult> {
  await requireAdmin();
  const res = await apiAddFeature(productId, input);
  if (res.ok) revalidateProduct(productId);
  return toActionResult(res);
}

export async function updateFeatureAction(
  productId: string,
  featureId: string,
  input: Partial<ProductFeatureInput>
): Promise<ActionResult> {
  await requireAdmin();
  const res = await apiUpdateFeature(productId, featureId, input);
  if (res.ok) revalidateProduct(productId);
  return toActionResult(res);
}

export async function deleteFeatureAction(
  productId: string,
  featureId: string
): Promise<ActionResult> {
  await requireAdmin();
  const res = await apiDeleteFeature(productId, featureId);
  if (res.ok) revalidateProduct(productId);
  return toActionResult(res);
}

// ─── Specifications ───────────────────────────────────────────────────────────

export async function addSpecificationAction(
  productId: string,
  input: ProductSpecificationInput
): Promise<ActionResult> {
  await requireAdmin();
  const res = await apiAddSpecification(productId, input);
  if (res.ok) revalidateProduct(productId);
  return toActionResult(res);
}

export async function updateSpecificationAction(
  productId: string,
  specificationId: string,
  input: Partial<ProductSpecificationInput>
): Promise<ActionResult> {
  await requireAdmin();
  const res = await apiUpdateSpecification(productId, specificationId, input);
  if (res.ok) revalidateProduct(productId);
  return toActionResult(res);
}

export async function deleteSpecificationAction(
  productId: string,
  specificationId: string
): Promise<ActionResult> {
  await requireAdmin();
  const res = await apiDeleteSpecification(productId, specificationId);
  if (res.ok) revalidateProduct(productId);
  return toActionResult(res);
}

// ─── Media links ──────────────────────────────────────────────────────────────

export async function addMediaAction(
  productId: string,
  input: ProductMediaInput
): Promise<ActionResult> {
  await requireAdmin();
  const res = await apiAddMedia(productId, input);
  if (res.ok) revalidateProduct(productId);
  return toActionResult(res);
}

export async function removeMediaAction(
  productId: string,
  productMediaId: string
): Promise<ActionResult> {
  await requireAdmin();
  const res = await apiRemoveMedia(productId, productMediaId);
  if (res.ok) revalidateProduct(productId);
  return toActionResult(res);
}

// ─── Reads for client components (experience editor) ──────────────────────────

export async function listProductsForPickerAction(
  search?: string
): Promise<ActionResult<ProductListResult>> {
  await requireAdmin();
  const query: Partial<ListProductsQuery> = { page: 1, pageSize: 50 };
  if (search) query.search = search;
  return toActionResult(await fetchProducts(query));
}

export async function getProductDisplayAction(
  productId: string
): Promise<ActionResult<ProductDisplayData>> {
  await requireAdmin();
  return toActionResult(await fetchProductDisplay(productId));
}
