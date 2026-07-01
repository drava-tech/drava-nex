import { describe, it, expect } from "vitest";
import {
  detectionLabelSchema,
  createProductSchema,
  listProductsQuerySchema,
  productDetectedEventSchema,
} from "@platform/types";

describe("detectionLabelSchema", () => {
  it("accepts machine-friendly labels", () => {
    for (const ok of ["smart_glasses", "vr_headset", "interactive_table", "cam01", "a"]) {
      expect(detectionLabelSchema.safeParse(ok).success).toBe(true);
    }
  });

  it("rejects spaces, hyphens, capitals and symbols", () => {
    for (const bad of ["Smart Glasses", "smart-glasses", "smart glasses", "VR", "glasses!", ""]) {
      expect(detectionLabelSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe("createProductSchema", () => {
  it("defaults status to DRAFT and omits blank optionals", () => {
    const parsed = createProductSchema.parse({ name: "Smart Glasses", slug: "smart-glasses", sku: "" });
    expect(parsed.status).toBe("DRAFT");
    expect(parsed.sku).toBeUndefined();
  });

  it("requires a valid slug", () => {
    expect(createProductSchema.safeParse({ name: "X", slug: "Not A Slug" }).success).toBe(false);
    expect(createProductSchema.safeParse({ name: "X", slug: "smart-glasses" }).success).toBe(true);
  });

  it("rejects an invalid detection label", () => {
    expect(
      createProductSchema.safeParse({ name: "X", slug: "x", detectionLabel: "Bad Label" }).success
    ).toBe(false);
  });
});

describe("listProductsQuerySchema", () => {
  it("coerces page/pageSize from query strings", () => {
    const parsed = listProductsQuerySchema.parse({ page: "2", pageSize: "10" });
    expect(parsed.page).toBe(2);
    expect(parsed.pageSize).toBe(10);
  });

  it("applies defaults", () => {
    const parsed = listProductsQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
  });
});

describe("productDetectedEventSchema", () => {
  it("validates a well-formed detection event", () => {
    const ev = productDetectedEventSchema.safeParse({
      type: "PRODUCT_DETECTED",
      cameraId: "camera-01",
      label: "smart_glasses",
      confidence: 0.94,
      detectedAt: new Date().toISOString(),
    });
    expect(ev.success).toBe(true);
  });

  it("rejects confidence outside 0..1", () => {
    expect(
      productDetectedEventSchema.safeParse({
        type: "PRODUCT_DETECTED",
        cameraId: "c",
        label: "smart_glasses",
        confidence: 1.5,
        detectedAt: new Date().toISOString(),
      }).success
    ).toBe(false);
  });
});
