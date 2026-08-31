import "server-only";
import type { CreateCompanyInput, UpdateCompanyInput, SearchCompaniesQuery } from "@platform/types";
import type { Company, CompanySearchResult } from "@platform/db";
import { apiFetch } from "./api-client";

/**
 * Server-side client for the Hono company API (`/api/companies`). Mirrors
 * products-api.ts's shape — the CMS never talks to the `company` table
 * directly, it forwards the caller's auth cookie to the API.
 */

export type { ApiResult, ApiError } from "./api-client";
export type { CompanySearchResult };

function toQueryString(query: Partial<SearchCompaniesQuery>): string {
  const params = new URLSearchParams();
  if (query.search) params.set("search", query.search);
  if (query.limit) params.set("limit", String(query.limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function fetchCompanies(query: Partial<SearchCompaniesQuery>) {
  return apiFetch<CompanySearchResult[]>(`/api/companies${toQueryString(query)}`);
}

export function apiCreateCompany(input: CreateCompanyInput) {
  return apiFetch<Company>(`/api/companies`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function apiUpdateCompany(companyId: string, input: UpdateCompanyInput) {
  return apiFetch<Company>(`/api/companies/${encodeURIComponent(companyId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function apiDeleteCompany(companyId: string) {
  return apiFetch<{ id: string; deleted: boolean }>(
    `/api/companies/${encodeURIComponent(companyId)}`,
    { method: "DELETE" }
  );
}
