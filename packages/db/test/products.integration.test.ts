import { describe, it, expect, afterAll } from "vitest";
import type { CreateProductInput } from "@platform/types";
import {
  db,
  sql,
  createProduct,
  updateProduct,
  softDeleteProduct,
  getProductDisplayData,
  getProductByDetectionLabel,
  addProductSpecification,
} from "../dist/index.js";

/**
 * DB-backed integration tests. They run only when DATABASE_URL is set (e.g. after
 * `pnpm infra:up`), and clean up every row they create. Pure-unit coverage of the
 * schemas + detection lives in apps/api.
 */
const RUN = Boolean(process.env["DATABASE_URL"]);
const PREFIX = `vitest_${Date.now()}`;

function sample(suffix: string, overrides: Partial<CreateProductInput> = {}): CreateProductInput {
  return {
    name: `Vitest ${suffix}`,
    slug: `${PREFIX}-${suffix}`,
    status: "ACTIVE",
    ...overrides,
  } as CreateProductInput;
}

describe.skipIf(!RUN)("product queries (integration)", () => {
  afterAll(async () => {
    // Hard-delete everything this run created (cascades to children).
    await db.execute(sql`DELETE FROM "product" WHERE slug LIKE ${`${PREFIX}-%`}`);
  });

  it("creates a product and assembles a grouped display payload", async () => {
    const p = await createProduct(
      sample("display", { detectionLabel: `${PREFIX}_display`, sku: `${PREFIX}-SKU-D` }),
      null
    );
    await addProductSpecification(p.id, { groupName: "Connectivity", label: "Network", value: "Wi-Fi", sortOrder: 0 });
    await addProductSpecification(p.id, { groupName: "Connectivity", label: "Protocol", value: "WebSocket", sortOrder: 1 });
    await addProductSpecification(p.id, { groupName: "Usage", label: "Mode", value: "Hands-free", sortOrder: 2 });

    const display = await getProductDisplayData(p.id);
    expect(display).not.toBeNull();
    expect(display!.status).toBe("ACTIVE");
    expect(display!.specificationGroups.map((g) => g.name)).toEqual(["Connectivity", "Usage"]);
    expect(display!.specificationGroups[0]!.items).toHaveLength(2);
  });

  it("rejects duplicate slug, sku and detection label", async () => {
    await createProduct(
      sample("dupes", { sku: `${PREFIX}-SKU-X`, detectionLabel: `${PREFIX}_dupes` }),
      null
    );
    // Same slug
    await expect(createProduct(sample("dupes"), null)).rejects.toBeTruthy();
    // Same sku, different slug
    await expect(
      createProduct(sample("dupes2", { sku: `${PREFIX}-SKU-X` }), null)
    ).rejects.toBeTruthy();
    // Same detection label, different slug
    await expect(
      createProduct(sample("dupes3", { detectionLabel: `${PREFIX}_dupes` }), null)
    ).rejects.toBeTruthy();
  });

  it("returns ACTIVE products by detection label, and hides inactive ones", async () => {
    const label = `${PREFIX}_lookup`;
    const p = await createProduct(sample("lookup", { detectionLabel: label }), null);

    expect((await getProductByDetectionLabel(label))?.productId).toBe(p.id);

    await updateProduct(p.id, { status: "INACTIVE" });
    expect(await getProductByDetectionLabel(label)).toBeNull();

    // The display query still returns the row (status INACTIVE) so the caller can
    // show the "unavailable" screen rather than a hard error.
    const display = await getProductDisplayData(p.id);
    expect(display?.status).toBe("INACTIVE");
  });

  it("soft-deletes a product out of the display query", async () => {
    const p = await createProduct(sample("del"), null);
    await softDeleteProduct(p.id);
    expect(await getProductDisplayData(p.id)).toBeNull();
  });
});
