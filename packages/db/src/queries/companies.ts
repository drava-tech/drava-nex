import { eq, and, isNull, ilike, asc, count, sql } from "drizzle-orm";
import { db } from "../client.js";
import {
  company,
  portfolioProject,
  portfolioCategory,
  portfolioVertical,
  type Company,
} from "../schema/portfolio.js";
import { experience } from "../schema/projects.js";

/**
 * Company data access. A company is global — not scoped to any one
 * experience/vertical/category — so it can be reused across the whole
 * portfolio and its total project count queried directly.
 */

// ─── Errors ───────────────────────────────────────────────────────────────────

export class CompanyNotFoundError extends Error {
  constructor(message = "Company not found") {
    super(message);
    this.name = "CompanyNotFoundError";
  }
}

// ─── Slug helper (kept in sync with packages/ui/src/templates/portfolio/content.ts) ──

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ─── Read ───────────────────────────────────────────────────────────────────

export interface CompanySearchResult {
  id: string;
  name: string;
  slug: string;
  projectCount: number;
}

/** Typeahead search — active (non-deleted) companies matching `query`, with their project count. */
export async function searchCompanies(query: string, limit = 20): Promise<CompanySearchResult[]> {
  const term = `%${query.trim()}%`;
  const rows = await db
    .select({
      id: company.id,
      name: company.name,
      slug: company.slug,
      projectCount: count(portfolioProject.id),
    })
    .from(company)
    .leftJoin(portfolioProject, eq(portfolioProject.companyId, company.id))
    .where(and(isNull(company.deletedAt), query.trim() ? ilike(company.name, term) : undefined))
    .groupBy(company.id)
    .orderBy(asc(company.name))
    .limit(limit);
  return rows;
}

export async function getCompanyDetail(id: string): Promise<Company | null> {
  const [row] = await db
    .select()
    .from(company)
    .where(and(eq(company.id, id), isNull(company.deletedAt)))
    .limit(1);
  return row ?? null;
}

export interface CompanyProjectRef {
  projectId: string;
  projectTitle: string | null;
  categoryId: string;
  categoryName: string;
  verticalId: string;
  verticalTitle: string;
  experienceId: string;
  experienceName: string;
}

/** Every project across the whole portfolio linked to this company — the "what have we done for Company X" view. */
export async function getCompanyProjects(companyId: string): Promise<CompanyProjectRef[]> {
  const rows = await db
    .select({
      projectId: portfolioProject.id,
      projectTitle: portfolioProject.title,
      categoryId: portfolioCategory.id,
      categoryName: portfolioCategory.name,
      verticalId: portfolioVertical.id,
      verticalTitle: portfolioVertical.title,
      experienceId: experience.id,
      experienceName: experience.name,
    })
    .from(portfolioProject)
    .innerJoin(portfolioCategory, eq(portfolioProject.categoryId, portfolioCategory.id))
    .innerJoin(portfolioVertical, eq(portfolioCategory.verticalId, portfolioVertical.id))
    .innerJoin(experience, eq(portfolioVertical.experienceId, experience.id))
    .where(eq(portfolioProject.companyId, companyId))
    .orderBy(asc(experience.name), asc(portfolioVertical.slotIndex), asc(portfolioCategory.slotIndex));
  return rows;
}

// ─── Write ──────────────────────────────────────────────────────────────────

export async function createCompany(name: string): Promise<Company> {
  const slug = slugify(name);
  const [row] = await db.insert(company).values({ name: name.trim(), slug }).returning();
  if (!row) throw new Error("Failed to create company");
  return row;
}

export async function updateCompany(id: string, name: string): Promise<Company> {
  const [row] = await db
    .update(company)
    .set({ name: name.trim(), slug: slugify(name), updatedAt: new Date() })
    .where(and(eq(company.id, id), isNull(company.deletedAt)))
    .returning();
  if (!row) throw new CompanyNotFoundError();
  return row;
}

export async function softDeleteCompany(id: string): Promise<void> {
  const [row] = await db
    .update(company)
    .set({ deletedAt: new Date() })
    .where(and(eq(company.id, id), isNull(company.deletedAt)))
    .returning({ id: company.id });
  if (!row) throw new CompanyNotFoundError();
}

/**
 * Find an active company by name (matched by slug) or create one. Used by the
 * project save path so typing a brand-new company name links it in one call,
 * and by the backfill script — both need the same "one row per real company"
 * dedupe. `onConflictDoNothing` + follow-up select handles the race between
 * concurrent callers resolving the same brand-new name.
 */
export async function findOrCreateCompanyByName(name: string): Promise<Company> {
  const trimmed = name.trim();
  const slug = slugify(trimmed);

  const [existing] = await db
    .select()
    .from(company)
    .where(and(eq(company.slug, slug), isNull(company.deletedAt)))
    .limit(1);
  if (existing) return existing;

  const [inserted] = await db
    .insert(company)
    .values({ name: trimmed, slug })
    .onConflictDoNothing({ target: company.slug, where: sql`${company.deletedAt} IS NULL` })
    .returning();
  if (inserted) return inserted;

  // Lost the race to a concurrent insert (or slug collides with a soft-deleted row) — read it back.
  const [row] = await db.select().from(company).where(eq(company.slug, slug)).limit(1);
  if (!row) throw new Error(`Failed to find or create company "${trimmed}"`);
  return row;
}
