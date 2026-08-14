import "server-only";
import type {
  UpdateProjectInput,
  CreateProjectInput,
  ReorderInput,
  AddProjectImageInput,
  AddProjectVideoInput,
} from "@platform/types";
import type {
  PortfolioProject,
  PortfolioProjectImage,
  PortfolioProjectVideo,
} from "@platform/db";
import { apiFetch } from "./api-client";

/**
 * Server-side client for the Hono portfolio API (`/api/portfolio`). Mirrors
 * products-api.ts's shape — only the "Projects" (companies) sub-tree is
 * wired here; verticals/categories/settings still go through the old
 * experience-content endpoint (experience-actions.ts).
 */

export type { ApiResult, ApiError } from "./api-client";

// ─── Projects ───────────────────────────────────────────────────────────────

export function apiCreatePortfolioProject(categoryId: string, input: CreateProjectInput) {
  return apiFetch<PortfolioProject>(
    `/api/portfolio/categories/${encodeURIComponent(categoryId)}/projects`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function apiUpdatePortfolioProject(projectId: string, input: UpdateProjectInput) {
  return apiFetch<PortfolioProject>(`/api/portfolio/projects/${encodeURIComponent(projectId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function apiDeletePortfolioProject(projectId: string) {
  return apiFetch<{ id: string; deleted: boolean }>(
    `/api/portfolio/projects/${encodeURIComponent(projectId)}`,
    { method: "DELETE" }
  );
}

export function apiReorderPortfolioProjects(categoryId: string, input: ReorderInput) {
  return apiFetch<{ reordered: boolean }>(
    `/api/portfolio/categories/${encodeURIComponent(categoryId)}/projects/reorder`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

// ─── Project images ───────────────────────────────────────────────────────────

export function apiAddProjectImage(projectId: string, input: AddProjectImageInput) {
  return apiFetch<PortfolioProjectImage>(
    `/api/portfolio/projects/${encodeURIComponent(projectId)}/images`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function apiRemoveProjectImage(projectId: string, imageId: string) {
  return apiFetch<{ id: string; deleted: boolean }>(
    `/api/portfolio/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}`,
    { method: "DELETE" }
  );
}

export function apiReorderProjectImages(projectId: string, input: ReorderInput) {
  return apiFetch<{ reordered: boolean }>(
    `/api/portfolio/projects/${encodeURIComponent(projectId)}/images/reorder`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

// ─── Project videos ───────────────────────────────────────────────────────────

export function apiAddProjectVideo(projectId: string, input: AddProjectVideoInput) {
  return apiFetch<PortfolioProjectVideo>(
    `/api/portfolio/projects/${encodeURIComponent(projectId)}/videos`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function apiRemoveProjectVideo(projectId: string, videoId: string) {
  return apiFetch<{ id: string; deleted: boolean }>(
    `/api/portfolio/projects/${encodeURIComponent(projectId)}/videos/${encodeURIComponent(videoId)}`,
    { method: "DELETE" }
  );
}

export function apiReorderProjectVideos(projectId: string, input: ReorderInput) {
  return apiFetch<{ reordered: boolean }>(
    `/api/portfolio/projects/${encodeURIComponent(projectId)}/videos/reorder`,
    { method: "POST", body: JSON.stringify(input) }
  );
}
