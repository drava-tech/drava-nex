import "server-only";
import type {
  CreateProductInput,
  UpdateProductInput,
  ListProductsQuery,
  ProductFeatureInput,
  ProductSpecificationInput,
  ProductMediaInput,
  ProductDisplayData,
} from "@platform/types";
import type {
  Product,
  ProductDetail,
  ProductListResult,
} from "@platform/db";
import { apiFetch } from "./api-client";

/**
 * Server-side client for the Hono product API. The CMS never touches the product
 * tables directly — it forwards the caller's auth cookie to the API so the same
 * admin session is enforced there (see api-client.ts).
 */

export type { ApiResult, ApiError } from "./api-client";

function toQueryString(query: Partial<ListProductsQuery>): string {
  const params = new URLSearchParams();
  if (query.page) params.set("page", String(query.page));
  if (query.pageSize) params.set("pageSize", String(query.pageSize));
  if (query.search) params.set("search", query.search);
  if (query.category) params.set("category", query.category);
  if (query.status) params.set("status", query.status);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export function fetchProducts(query: Partial<ListProductsQuery>) {
  return apiFetch<ProductListResult>(`/api/products${toQueryString(query)}`);
}

export function fetchProduct(productId: string) {
  return apiFetch<ProductDetail>(`/api/products/${encodeURIComponent(productId)}`);
}

export function fetchProductDisplay(productId: string) {
  return apiFetch<ProductDisplayData>(
    `/api/products/${encodeURIComponent(productId)}/display`
  );
}

// ─── Product writes ───────────────────────────────────────────────────────────

export function apiCreateProduct(input: CreateProductInput) {
  return apiFetch<Product>(`/api/products`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function apiUpdateProduct(productId: string, input: UpdateProductInput) {
  return apiFetch<Product>(`/api/products/${encodeURIComponent(productId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function apiDeleteProduct(productId: string) {
  return apiFetch<{ id: string; deleted: boolean }>(
    `/api/products/${encodeURIComponent(productId)}`,
    { method: "DELETE" }
  );
}

// ─── Features ─────────────────────────────────────────────────────────────────

export function apiAddFeature(productId: string, input: ProductFeatureInput) {
  return apiFetch(`/api/products/${encodeURIComponent(productId)}/features`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function apiUpdateFeature(
  productId: string,
  featureId: string,
  input: Partial<ProductFeatureInput>
) {
  return apiFetch(
    `/api/products/${encodeURIComponent(productId)}/features/${encodeURIComponent(featureId)}`,
    { method: "PATCH", body: JSON.stringify(input) }
  );
}

export function apiDeleteFeature(productId: string, featureId: string) {
  return apiFetch(
    `/api/products/${encodeURIComponent(productId)}/features/${encodeURIComponent(featureId)}`,
    { method: "DELETE" }
  );
}

// ─── Specifications ───────────────────────────────────────────────────────────

export function apiAddSpecification(productId: string, input: ProductSpecificationInput) {
  return apiFetch(`/api/products/${encodeURIComponent(productId)}/specifications`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function apiUpdateSpecification(
  productId: string,
  specificationId: string,
  input: Partial<ProductSpecificationInput>
) {
  return apiFetch(
    `/api/products/${encodeURIComponent(productId)}/specifications/${encodeURIComponent(specificationId)}`,
    { method: "PATCH", body: JSON.stringify(input) }
  );
}

export function apiDeleteSpecification(productId: string, specificationId: string) {
  return apiFetch(
    `/api/products/${encodeURIComponent(productId)}/specifications/${encodeURIComponent(specificationId)}`,
    { method: "DELETE" }
  );
}

// ─── Media links ──────────────────────────────────────────────────────────────

export function apiAddMedia(productId: string, input: ProductMediaInput) {
  return apiFetch(`/api/products/${encodeURIComponent(productId)}/media`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function apiRemoveMedia(productId: string, productMediaId: string) {
  return apiFetch(
    `/api/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(productMediaId)}`,
    { method: "DELETE" }
  );
}
