import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB layer so this stays a pure unit test (no Postgres connection).
const { getProductByDetectionLabel } = vi.hoisted(() => ({
  getProductByDetectionLabel: vi.fn(),
}));
vi.mock("@platform/db", () => ({ getProductByDetectionLabel }));

import { resolveDetectedProduct } from "../src/services/detection.js";

describe("resolveDetectedProduct", () => {
  beforeEach(() => {
    getProductByDetectionLabel.mockReset();
    process.env["DETECTION_MIN_CONFIDENCE"] = "0.7";
  });

  it("rejects an invalid label without hitting the DB", async () => {
    const res = await resolveDetectedProduct({
      cameraId: "camera-01",
      detectionLabel: "Bad Label",
      confidence: 0.99,
    });
    expect(res.matched).toBe(false);
    expect(res.reason).toBe("INVALID_EVENT");
    expect(getProductByDetectionLabel).not.toHaveBeenCalled();
  });

  it("rejects low-confidence detections before lookup", async () => {
    const res = await resolveDetectedProduct({
      cameraId: "camera-01",
      detectionLabel: "smart_glasses",
      confidence: 0.5,
    });
    expect(res.matched).toBe(false);
    expect(res.reason).toBe("LOW_CONFIDENCE");
    expect(getProductByDetectionLabel).not.toHaveBeenCalled();
  });

  it("returns NO_MATCH when no active product has the label", async () => {
    getProductByDetectionLabel.mockResolvedValue(null);
    const res = await resolveDetectedProduct({
      cameraId: "camera-01",
      detectionLabel: "smart_glasses",
      confidence: 0.9,
    });
    expect(res.matched).toBe(false);
    expect(res.reason).toBe("NO_MATCH");
  });

  it("resolves the productId for a confident, known label", async () => {
    getProductByDetectionLabel.mockResolvedValue({
      productId: "product-123",
      name: "Smart Glasses",
      detectionLabel: "smart_glasses",
      status: "ACTIVE",
    });
    const res = await resolveDetectedProduct({
      cameraId: "camera-01",
      detectionLabel: "smart_glasses",
      confidence: 0.94,
    });
    expect(res.matched).toBe(true);
    expect(res.productId).toBe("product-123");
  });
});
