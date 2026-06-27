import "server-only";
import { headers } from "next/headers";
import type {
  CreateProductInput,
  UpdateProductInput,
  ListProductsQuery,
  ProductFeatureInput,
  ProductSpecificationInput,
  ProductMediaInput,
  ProductDisplayData,
  FieldError,
} from "@platform/types";
import type {
  Product,
  ProductDetail,
  ProductListResult,
} from "@platform/db";

/**
 * Server-side client for the Hono product API. The CMS never touches the product
 * tables directly — it forwards the caller's auth cookie to the API so the same
 * admin session is enforced there. Keeping all product logic behind the API is
 * what keeps the frontend and backend separated (no duplicated data access).
 */

const API_BASE = process.env["INTERNAL_API_URL"] ?? "http://localhost:4000";

export interface ApiError {
  code: string;
  message: string;
  details?: FieldError[] | unknown;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: ApiError };

async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const cookie = (await headers()).get("cookie") ?? "";
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        cookie,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (cause) {
    return {
      ok: false,
      status: 0,
      error: { code: "NETWORK", message: "Could not reach the product service." },
    };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty / non-JSON body */
  }

  if (!res.ok) {
    const err = (body as { error?: ApiError } | null)?.error;
    return {
      ok: false,
      status: res.status,
      error: err ?? { code: "HTTP_ERROR", message: `Request failed (${res.status}).` },
    };
  }

  return { ok: true, data: (body as { data: T }).data };
}

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
