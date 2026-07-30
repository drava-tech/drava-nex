import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Screen-takeover behavior for camera product detection.
 *
 * Exercises the real resolveDetectedProduct chain (only the DB layer is mocked)
 * through gateway.applyProductDetection / clearProductDetection — the single
 * implementation shared by the browser WebSocket path (useServerDetection.ts →
 * PRODUCT_DETECTED) and the headless relay (POST /api/internal/vision-event).
 */

const { getProductByDetectionLabel, getScreenContent } = vi.hoisted(() => ({
  getProductByDetectionLabel: vi.fn(),
  getScreenContent: vi.fn(),
}));

vi.mock("@platform/db", () => ({
  getProductByDetectionLabel,
  getScreenContent,
  setScreenExperience: vi.fn(),
  verifyApiKey: vi.fn(),
  scopeSatisfies: vi.fn(),
}));

// camera-01 → main-screen, camera-02 → screen-2, camera-99 → unmapped.
vi.mock("../src/lib/camera-map.js", () => ({
  getCameraScreen: (cameraId: string) =>
    ({ "camera-01": "main-screen", "camera-02": "screen-2" })[cameraId] ?? null,
}));

const {
  applyProductDetection,
  clearProductDetection,
  getContentCache,
} = await import("../src/ws/gateway.js");

const ASSIGNED_CONTENT = {
  id: "assigned-experience",
  type: "experience" as const,
  source: "",
  title: "Assigned Experience",
  templateKey: "hero",
};

const COSTER_PRODUCT = {
  productId: "product-123",
  name: "Coaster",
  detectionLabel: "coster",
  status: "ACTIVE",
};

async function takeOverMainScreen() {
  getProductByDetectionLabel.mockResolvedValue(COSTER_PRODUCT);
  return applyProductDetection({ cameraId: "camera-01", label: "coster", confidence: 0.95 });
}

describe("applyProductDetection", () => {
  beforeEach(async () => {
    // Drop any takeover a previous test left behind BEFORE resetting the mocks,
    // so the cleanup's own getScreenContent call isn't counted by a test.
    getScreenContent.mockResolvedValue(ASSIGNED_CONTENT);
    await clearProductDetection({ cameraId: "camera-01", label: "coster" });
    await clearProductDetection({ cameraId: "camera-02", label: "coster" });

    getProductByDetectionLabel.mockReset();
    getScreenContent.mockReset();
    getScreenContent.mockResolvedValue(ASSIGNED_CONTENT);
    process.env["DETECTION_MIN_CONFIDENCE"] = "0.7";
  });

  it("displays the product showcase for a confident, active, known label", async () => {
    const res = await takeOverMainScreen();

    expect(res).toMatchObject({ applied: true, screenId: "main-screen", productId: "product-123" });

    const content = getContentCache("main-screen");
    expect(content?.templateKey).toBe("product-showcase");
    expect(content?.templateContent?.["product-showcase"]).toEqual({ productId: "product-123" });
    expect(content?.title).toBe("Coaster");
  });

  it("rejects a low-confidence detection without touching the screen", async () => {
    const res = await applyProductDetection({
      cameraId: "camera-01",
      label: "coster",
      confidence: 0.5,
    });

    expect(res).toEqual({ applied: false, reason: "LOW_CONFIDENCE" });
    expect(getProductByDetectionLabel).not.toHaveBeenCalled();
    expect(getContentCache("main-screen")?.templateKey).not.toBe("product-showcase");
  });

  it("rejects a malformed label before any lookup", async () => {
    const res = await applyProductDetection({
      cameraId: "camera-01",
      label: "Not A Label!",
      confidence: 0.99,
    });

    expect(res).toEqual({ applied: false, reason: "INVALID_EVENT" });
    expect(getProductByDetectionLabel).not.toHaveBeenCalled();
  });

  it("rejects a confidence outside 0..1", async () => {
    const res = await applyProductDetection({
      cameraId: "camera-01",
      label: "coster",
      confidence: 1.4,
    });
    expect(res).toEqual({ applied: false, reason: "INVALID_EVENT" });
  });

  it("does not display anything for a label with no active product", async () => {
    getProductByDetectionLabel.mockResolvedValue(null);

    const res = await applyProductDetection({
      cameraId: "camera-01",
      label: "unknown_thing",
      confidence: 0.95,
    });

    expect(res).toEqual({ applied: false, reason: "NO_MATCH" });
    expect(getContentCache("main-screen")?.templateKey).not.toBe("product-showcase");
  });

  it("is a no-op for a camera with no screen mapping", async () => {
    const res = await applyProductDetection({
      cameraId: "camera-99",
      label: "coster",
      confidence: 0.95,
    });

    expect(res).toEqual({ applied: false, reason: "NO_SCREEN" });
    expect(getProductByDetectionLabel).not.toHaveBeenCalled();
  });
});

describe("clearProductDetection", () => {
  beforeEach(async () => {
    // Drop any takeover a previous test left behind BEFORE resetting the mocks,
    // so the cleanup's own getScreenContent call isn't counted by a test.
    getScreenContent.mockResolvedValue(ASSIGNED_CONTENT);
    await clearProductDetection({ cameraId: "camera-01", label: "coster" });
    await clearProductDetection({ cameraId: "camera-02", label: "coster" });

    getProductByDetectionLabel.mockReset();
    getScreenContent.mockReset();
    getScreenContent.mockResolvedValue(ASSIGNED_CONTENT);
    process.env["DETECTION_MIN_CONFIDENCE"] = "0.7";
  });

  it("restores the screen's assigned content when the same label is lost", async () => {
    await takeOverMainScreen();
    expect(getContentCache("main-screen")?.templateKey).toBe("product-showcase");

    const cleared = await clearProductDetection({ cameraId: "camera-01", label: "coster" });

    expect(cleared).toBe(true);
    expect(getContentCache("main-screen")).toMatchObject({ id: "assigned-experience" });
  });

  it("ignores a lost event for a different label than the one holding the screen", async () => {
    await takeOverMainScreen();

    const cleared = await clearProductDetection({
      cameraId: "camera-01",
      label: "smart_glasses",
    });

    expect(cleared).toBe(false);
    expect(getContentCache("main-screen")?.templateKey).toBe("product-showcase");
  });

  it("is a no-op when the screen is showing normal assigned content", async () => {
    const cleared = await clearProductDetection({ cameraId: "camera-01", label: "coster" });
    expect(cleared).toBe(false);
    expect(getScreenContent).not.toHaveBeenCalled();
  });

  it("does not disturb an unrelated screen's takeover", async () => {
    getProductByDetectionLabel.mockResolvedValue(COSTER_PRODUCT);
    await applyProductDetection({ cameraId: "camera-01", label: "coster", confidence: 0.95 });
    await applyProductDetection({ cameraId: "camera-02", label: "coster", confidence: 0.95 });

    await clearProductDetection({ cameraId: "camera-01", label: "coster" });

    expect(getContentCache("main-screen")).toMatchObject({ id: "assigned-experience" });
    expect(getContentCache("screen-2")?.templateKey).toBe("product-showcase");
  });

  it("is a no-op for an unmapped camera", async () => {
    expect(await clearProductDetection({ cameraId: "camera-99", label: "coster" })).toBe(false);
  });
});
