import { Hono } from "hono";
import type { Context } from "hono";
import {
  listProducts,
  getProductDetail,
  getProductDisplayData,
  getProductByDetectionLabel,
  createProduct,
  updateProduct,
  softDeleteProduct,
  addProductFeature,
  updateProductFeature,
  deleteProductFeature,
  addProductSpecification,
  updateProductSpecification,
  deleteProductSpecification,
  addProductMedia,
  removeProductMedia,
  ProductNotFoundError,
} from "@platform/db";
import {
  listProductsQuerySchema,
  createProductSchema,
  updateProductSchema,
  productFeatureInputSchema,
  productSpecificationInputSchema,
  productMediaInputSchema,
  formatZodError,
} from "@platform/types";
import type { z } from "zod";
import { requireAdmin } from "../middleware/auth.js";
import { ok, fail, uniqueViolationField } from "../lib/response.js";

type SessionUser = { id: string; name: string; email: string; role: string };

/** Read a route param as a definite string (the route pattern guarantees it). */
function getParam(c: Context, name: string): string {
  return (c.req.param() as Record<string, string | undefined>)[name] ?? "";
}

/** Translate thrown errors into the standard envelope without leaking internals. */
function handleError(c: Parameters<typeof ok>[0], err: unknown) {
  if (err instanceof ProductNotFoundError) {
    return fail(c, "NOT_FOUND", err.message, 404);
  }
  const dupField = uniqueViolationField(err);
  if (dupField) {
    return fail(
      c,
      "DUPLICATE",
      `A product with this ${dupField} already exists.`,
      409,
      { field: dupField }
    );
  }
  console.error("[products] unhandled error:", err);
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

export const productsRouter = new Hono();

// --- Reads ---

// GET /api/products — list (admin)
productsRouter.get("/", requireAdmin, async (c) => {
  const parsed = listProductsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return fail(c, "VALIDATION", "Invalid query.", 422, formatZodError(parsed.error));
  }
  try {
    return ok(c, await listProducts(parsed.data));
  } catch (err) {
    return handleError(c, err);
  }
});

// GET /api/products/by-detection-label/:detectionLabel — public (ACTIVE-only)
productsRouter.get("/by-detection-label/:detectionLabel", async (c) => {
  try {
    const data = await getProductByDetectionLabel(getParam(c, "detectionLabel"));
    if (!data) return fail(c, "PRODUCT_NOT_FOUND", "No active product for that label.", 404);
    return ok(c, data);
  } catch (err) {
    return handleError(c, err);
  }
});

// GET /api/products/:productId — detail (admin)
productsRouter.get("/:productId", requireAdmin, async (c) => {
  try {
    const detail = await getProductDetail(getParam(c, "productId"));
    if (!detail) return fail(c, "PRODUCT_NOT_FOUND", "Product not found.", 404);
    return ok(c, detail);
  } catch (err) {
    return handleError(c, err);
  }
});

// GET /api/products/:productId/display — public display payload (ACTIVE-only)
productsRouter.get("/:productId/display", async (c) => {
  try {
    const data = await getProductDisplayData(getParam(c, "productId"));
    if (!data) return fail(c, "PRODUCT_NOT_FOUND", "Product not found.", 404);
    if (data.status !== "ACTIVE") {
      return fail(c, "PRODUCT_INACTIVE", "This product is not currently available.", 409, {
        status: data.status,
      });
    }
    return ok(c, data);
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Create ---

// POST /api/products — create (admin)
productsRouter.post("/", requireAdmin, async (c) => {
  const body = await parseBody(c, createProductSchema);
  if (!body.ok) return body.res;
  const user = c.get("user" as never) as SessionUser;
  try {
    const created = await createProduct(body.data, user?.id ?? null);
    return ok(c, created, 201);
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Update ---

// PATCH /api/products/:productId — update (admin)
productsRouter.patch("/:productId", requireAdmin, async (c) => {
  const body = await parseBody(c, updateProductSchema);
  if (!body.ok) return body.res;
  try {
    return ok(c, await updateProduct(getParam(c, "productId"), body.data));
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Delete ---

// DELETE /api/products/:productId — soft delete (admin)
productsRouter.delete("/:productId", requireAdmin, async (c) => {
  try {
    await softDeleteProduct(getParam(c, "productId"));
    return ok(c, { id: getParam(c, "productId"), deleted: true });
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Nested: features ---

productsRouter.post("/:productId/features", requireAdmin, async (c) => {
  const body = await parseBody(c, productFeatureInputSchema);
  if (!body.ok) return body.res;
  try {
    return ok(c, await addProductFeature(getParam(c, "productId"), body.data), 201);
  } catch (err) {
    return handleError(c, err);
  }
});

productsRouter.patch("/:productId/features/:featureId", requireAdmin, async (c) => {
  const body = await parseBody(c, productFeatureInputSchema.partial());
  if (!body.ok) return body.res;
  try {
    return ok(
      c,
      await updateProductFeature(getParam(c, "productId"), getParam(c, "featureId"), body.data)
    );
  } catch (err) {
    return handleError(c, err);
  }
});

productsRouter.delete("/:productId/features/:featureId", requireAdmin, async (c) => {
  try {
    await deleteProductFeature(getParam(c, "productId"), getParam(c, "featureId"));
    return ok(c, { id: getParam(c, "featureId"), deleted: true });
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Nested: specifications ---

productsRouter.post("/:productId/specifications", requireAdmin, async (c) => {
  const body = await parseBody(c, productSpecificationInputSchema);
  if (!body.ok) return body.res;
  try {
    return ok(c, await addProductSpecification(getParam(c, "productId"), body.data), 201);
  } catch (err) {
    return handleError(c, err);
  }
});

productsRouter.patch("/:productId/specifications/:specificationId", requireAdmin, async (c) => {
  const body = await parseBody(c, productSpecificationInputSchema.partial());
  if (!body.ok) return body.res;
  try {
    return ok(
      c,
      await updateProductSpecification(
        getParam(c, "productId"),
        getParam(c, "specificationId"),
        body.data
      )
    );
  } catch (err) {
    return handleError(c, err);
  }
});

productsRouter.delete("/:productId/specifications/:specificationId", requireAdmin, async (c) => {
  try {
    await deleteProductSpecification(
      getParam(c, "productId"),
      getParam(c, "specificationId")
    );
    return ok(c, { id: getParam(c, "specificationId"), deleted: true });
  } catch (err) {
    return handleError(c, err);
  }
});

// --- Nested: media links ---

productsRouter.post("/:productId/media", requireAdmin, async (c) => {
  const body = await parseBody(c, productMediaInputSchema);
  if (!body.ok) return body.res;
  try {
    return ok(c, await addProductMedia(getParam(c, "productId"), body.data), 201);
  } catch (err) {
    return handleError(c, err);
  }
});

productsRouter.delete("/:productId/media/:productMediaId", requireAdmin, async (c) => {
  try {
    await removeProductMedia(getParam(c, "productId"), getParam(c, "productMediaId"));
    return ok(c, { id: getParam(c, "productMediaId"), deleted: true });
  } catch (err) {
    return handleError(c, err);
  }
});
