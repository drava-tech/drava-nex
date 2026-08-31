"use server";

import { revalidatePath } from "next/cache";
import type {
  CreateProjectInput,
  UpdateProjectInput,
  ReorderInput,
  AddProjectImageInput,
  AddProjectVideoInput,
  CreateCompanyInput,
  FieldError,
} from "@platform/types";
import type { PortfolioProject, PortfolioProjectImage, PortfolioProjectVideo } from "@platform/db";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  apiCreatePortfolioProject,
  apiUpdatePortfolioProject,
  apiDeletePortfolioProject,
  apiReorderPortfolioProjects,
  apiAddProjectImage,
  apiRemoveProjectImage,
  apiReorderProjectImages,
  apiAddProjectVideo,
  apiRemoveProjectVideo,
  apiReorderProjectVideos,
  type ApiResult,
} from "@/lib/portfolio-api";
import { fetchCompanies, apiCreateCompany, type CompanySearchResult } from "@/lib/companies-api";

/**
 * Thin server actions over the Hono portfolio/companies APIs. They add the
 * admin guard + cache revalidation and translate API results into a
 * form-friendly shape — same split as product-actions.ts. Only the Projects
 * (companies) sub-tree is wired here; vertical/category/settings edits still
 * go through experience-actions.ts's whole-blob save.
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

function revalidatePortfolio() {
  revalidatePath("/experiences");
}

// ─── Projects ───────────────────────────────────────────────────────────────

export async function createPortfolioProjectAction(
  categoryId: string,
  input: CreateProjectInput
): Promise<ActionResult<PortfolioProject>> {
  await requireAdmin();
  const res = await apiCreatePortfolioProject(categoryId, input);
  if (res.ok) revalidatePortfolio();
  return toActionResult(res);
}

export async function updatePortfolioProjectAction(
  projectId: string,
  input: UpdateProjectInput
): Promise<ActionResult<PortfolioProject>> {
  await requireAdmin();
  const res = await apiUpdatePortfolioProject(projectId, input);
  if (res.ok) revalidatePortfolio();
  return toActionResult(res);
}

export async function deletePortfolioProjectAction(projectId: string): Promise<ActionResult> {
  await requireAdmin();
  const res = await apiDeletePortfolioProject(projectId);
  if (res.ok) revalidatePortfolio();
  return toActionResult(res);
}

export async function reorderPortfolioProjectsAction(
  categoryId: string,
  orderedIds: string[]
): Promise<ActionResult> {
  await requireAdmin();
  const input: ReorderInput = { orderedIds };
  const res = await apiReorderPortfolioProjects(categoryId, input);
  if (res.ok) revalidatePortfolio();
  return toActionResult(res);
}

// ─── Project images ───────────────────────────────────────────────────────────

export async function addPortfolioProjectImageAction(
  projectId: string,
  url: string
): Promise<ActionResult<PortfolioProjectImage>> {
  await requireAdmin();
  const input: AddProjectImageInput = { url };
  const res = await apiAddProjectImage(projectId, input);
  if (res.ok) revalidatePortfolio();
  return toActionResult(res);
}

export async function removePortfolioProjectImageAction(
  projectId: string,
  imageId: string
): Promise<ActionResult> {
  await requireAdmin();
  const res = await apiRemoveProjectImage(projectId, imageId);
  if (res.ok) revalidatePortfolio();
  return toActionResult(res);
}

export async function reorderPortfolioProjectImagesAction(
  projectId: string,
  orderedIds: string[]
): Promise<ActionResult> {
  await requireAdmin();
  const input: ReorderInput = { orderedIds };
  const res = await apiReorderProjectImages(projectId, input);
  if (res.ok) revalidatePortfolio();
  return toActionResult(res);
}

// ─── Project videos ───────────────────────────────────────────────────────────

export async function addPortfolioProjectVideoAction(
  projectId: string,
  url: string
): Promise<ActionResult<PortfolioProjectVideo>> {
  await requireAdmin();
  const input: AddProjectVideoInput = { url };
  const res = await apiAddProjectVideo(projectId, input);
  if (res.ok) revalidatePortfolio();
  return toActionResult(res);
}

export async function removePortfolioProjectVideoAction(
  projectId: string,
  videoId: string
): Promise<ActionResult> {
  await requireAdmin();
  const res = await apiRemoveProjectVideo(projectId, videoId);
  if (res.ok) revalidatePortfolio();
  return toActionResult(res);
}

export async function reorderPortfolioProjectVideosAction(
  projectId: string,
  orderedIds: string[]
): Promise<ActionResult> {
  await requireAdmin();
  const input: ReorderInput = { orderedIds };
  const res = await apiReorderProjectVideos(projectId, input);
  if (res.ok) revalidatePortfolio();
  return toActionResult(res);
}

// ─── Companies (reads/creates for the picker) ──────────────────────────────────

export async function searchCompaniesAction(
  search: string
): Promise<ActionResult<CompanySearchResult[]>> {
  await requireAdmin();
  return toActionResult(await fetchCompanies({ search, limit: 20 }));
}

export async function createCompanyAction(name: string): Promise<ActionResult<{ id: string; name: string }>> {
  await requireAdmin();
  const input: CreateCompanyInput = { name };
  const res = await apiCreateCompany(input);
  return toActionResult(res);
}
