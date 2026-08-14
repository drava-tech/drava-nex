import { Hono } from "hono";
import type { Context } from "hono";
import {
  searchCompanies,
  getCompanyDetail,
  getCompanyProjects,
  createCompany,
  updateCompany,
  softDeleteCompany,
  CompanyNotFoundError,
} from "@platform/db";
import {
  createCompanySchema,
  updateCompanySchema,
  searchCompaniesQuerySchema,
  formatZodError,
} from "@platform/types";
import type { z } from "zod";
import { requireAdmin } from "../middleware/auth.js";
import { ok, fail } from "../lib/response.js";

/** Read a route param as a definite string (the route pattern guarantees it). */
function getParam(c: Context, name: string): string {
  return (c.req.param() as Record<string, string | undefined>)[name] ?? "";
}

/** Translate thrown errors into the standard envelope without leaking internals. */
function handleError(c: Parameters<typeof ok>[0], err: unknown) {
  if (err instanceof CompanyNotFoundError) {
    return fail(c, "NOT_FOUND", err.message, 404);
  }
  console.error("[companies] unhandled error:", err);
  return fail(c, "INTERNAL", "Something went wrong.", 500);
}

/** Read + zod-validate a JSON body; returns the parsed value or sends a 422. */
async function parseBody<T extends z.ZodTypeAny>(
  c: Parameters<typeof ok>[0],
  schema: T
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, res: fail(c, "INVALID_BODY", "Request body must be valid JSON.", 422) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      res: fail(c, "VALIDATION", "Validation failed.", 422, formatZodError(result.error)),
    };
  }
  return { ok: true, data: result.data };
}

export const companiesRouter = new Hono();

// GET /api/companies?search=&limit= — typeahead (admin)
companiesRouter.get("/", requireAdmin, async (c) => {
  const parsed = searchCompaniesQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return fail(c, "VALIDATION", "Invalid query.", 422, formatZodError(parsed.error));
  }
  try {
    return ok(c, await searchCompanies(parsed.data.search ?? "", parsed.data.limit));
  } catch (err) {
    return handleError(c, err);
  }
});

// GET /api/companies/:companyId (admin)
companiesRouter.get("/:companyId", requireAdmin, async (c) => {
  try {
    const detail = await getCompanyDetail(getParam(c, "companyId"));
    if (!detail) return fail(c, "NOT_FOUND", "Company not found.", 404);
    return ok(c, detail);
  } catch (err) {
    return handleError(c, err);
  }
});

// GET /api/companies/:companyId/projects — every project across the portfolio (admin)
companiesRouter.get("/:companyId/projects", requireAdmin, async (c) => {
  try {
    return ok(c, await getCompanyProjects(getParam(c, "companyId")));
  } catch (err) {
    return handleError(c, err);
  }
});

// POST /api/companies (admin)
companiesRouter.post("/", requireAdmin, async (c) => {
  const body = await parseBody(c, createCompanySchema);
  if (!body.ok) return body.res;
  try {
    return ok(c, await createCompany(body.data.name), 201);
  } catch (err) {
    return handleError(c, err);
  }
});

// PATCH /api/companies/:companyId (admin)
companiesRouter.patch("/:companyId", requireAdmin, async (c) => {
  const body = await parseBody(c, updateCompanySchema);
  if (!body.ok) return body.res;
  try {
    return ok(c, await updateCompany(getParam(c, "companyId"), body.data.name));
  } catch (err) {
    return handleError(c, err);
  }
});

// DELETE /api/companies/:companyId — soft delete (admin)
companiesRouter.delete("/:companyId", requireAdmin, async (c) => {
  try {
    await softDeleteCompany(getParam(c, "companyId"));
    return ok(c, { id: getParam(c, "companyId"), deleted: true });
  } catch (err) {
    return handleError(c, err);
  }
});
