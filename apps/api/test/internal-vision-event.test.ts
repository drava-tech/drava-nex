import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/internal/vision-event — the headless relay used by services/vision.
 *
 * PRODUCT_DETECTED / PRODUCT_LOST must delegate to the gateway's single
 * takeover implementation rather than duplicating the product lookup, so the
 * gateway is mocked here and the assertions are about routing + payload
 * marshalling. Detection semantics are covered by product-detection.test.ts.
 */

const { applyProductDetection, clearProductDetection, broadcastToCms } = vi.hoisted(() => ({
  applyProductDetection: vi.fn(),
  clearProductDetection: vi.fn(),
  broadcastToCms: vi.fn(),
}));

vi.mock("../src/ws/gateway.js", () => ({
  applyProductDetection,
  clearProductDetection,
  broadcastToCms,
}));
vi.mock("../src/services/door-screen-trigger.js", () => ({
  showWelcomeScreenIfIdle: vi.fn(),
  isVisionTriggerArmed: () => false,
}));
vi.mock("../src/services/vision-snapshot-store.js", () => ({
  setLatestSnapshot: vi.fn(),
}));

const { internalRouter } = await import("../src/routes/internal.js");

const SECRET = "test-secret";

function post(body: unknown, secret: string | null = SECRET) {
  return internalRouter.request("/vision-event", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-broadcast-secret": secret } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /vision-event", () => {
  beforeEach(() => {
    applyProductDetection.mockReset();
    clearProductDetection.mockReset();
    broadcastToCms.mockReset();
    process.env["BROADCAST_SECRET"] = SECRET;
  });

  it("rejects a request without the shared secret", async () => {
    const res = await post({ type: "PRODUCT_DETECTED" }, null);
    expect(res.status).toBe(401);
    expect(applyProductDetection).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body", async () => {
    const res = await post("not json at all");
    expect(res.status).toBe(422);
  });

  it("rejects an unknown event type", async () => {
    const res = await post({ type: "NOPE" });
    expect(res.status).toBe(422);
  });

  it("forwards PRODUCT_DETECTED to the gateway takeover path", async () => {
    applyProductDetection.mockResolvedValue({
      applied: true,
      screenId: "main-screen",
      productId: "product-123",
    });

    const res = await post({
      type: "PRODUCT_DETECTED",
      cameraId: "camera-01",
      label: "coster",
      confidence: 0.93,
      detectedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(res.status).toBe(200);
    expect(applyProductDetection).toHaveBeenCalledWith({
      cameraId: "camera-01",
      label: "coster",
      confidence: 0.93,
      detectedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("passes a malformed payload through to be rejected downstream, not silently dropped", async () => {
    applyProductDetection.mockResolvedValue({ applied: false, reason: "INVALID_EVENT" });

    const res = await post({ type: "PRODUCT_DETECTED", cameraId: "camera-01" });

    expect(res.status).toBe(200);
    // confidence is absent → NaN, which the zod schema rejects as INVALID_EVENT.
    expect(applyProductDetection).toHaveBeenCalledWith(
      expect.objectContaining({ label: "", confidence: NaN })
    );
    expect(await res.json()).toMatchObject({
      data: { applied: false, reason: "INVALID_EVENT" },
    });
  });

  it("forwards PRODUCT_LOST with the owning label", async () => {
    clearProductDetection.mockResolvedValue(true);

    const res = await post({ type: "PRODUCT_LOST", cameraId: "camera-01", label: "coster" });

    expect(res.status).toBe(200);
    expect(clearProductDetection).toHaveBeenCalledWith({
      cameraId: "camera-01",
      label: "coster",
    });
    expect(await res.json()).toMatchObject({ data: { cleared: true } });
  });

  it("still relays VISITOR_DETECTED to the CMS", async () => {
    const res = await post({
      type: "VISITOR_DETECTED",
      uuid: "v-1",
      name: "",
      isNew: true,
      lastSeen: "2026-01-01T00:00:00.000Z",
      hasImage: true,
    });

    expect(res.status).toBe(200);
    expect(broadcastToCms).toHaveBeenCalledWith(
      expect.objectContaining({ type: "VISITOR_DETECTED", uuid: "v-1" })
    );
  });
});
