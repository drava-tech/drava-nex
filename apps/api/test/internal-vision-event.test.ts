import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/internal/vision-event — the headless relay used by services/vision.
 *
 * PRODUCT_DETECTED / PRODUCT_LOST must delegate to the gateway's single
 * takeover implementation rather than duplicating the product lookup, so the
 * gateway is mocked here and the assertions are about routing + payload
 * marshalling. Detection semantics are covered by product-detection.test.ts.
 */

const {
  applyProductDetection,
  clearProductDetection,
  broadcastToCms,
  showWelcomeScreenIfIdle,
  onVisitorDetected,
  recordAuthFailure,
  flags,
} = vi.hoisted(() => ({
  applyProductDetection: vi.fn(),
  clearProductDetection: vi.fn(),
  broadcastToCms: vi.fn(),
  showWelcomeScreenIfIdle: vi.fn(),
  onVisitorDetected: vi.fn(),
  recordAuthFailure: vi.fn(),
  // armed: the /api/vision-trigger switch; greeting: GREETING_ENABLED.
  flags: { armed: false, greeting: true },
}));

vi.mock("../src/ws/gateway.js", () => ({
  applyProductDetection,
  clearProductDetection,
  broadcastToCms,
}));
vi.mock("../src/services/door-screen-trigger.js", () => ({
  showWelcomeScreenIfIdle,
  isVisionTriggerArmed: () => flags.armed,
}));
vi.mock("../src/lib/greeting-flag.js", () => ({
  isGreetingEnabled: () => flags.greeting,
}));
vi.mock("../src/services/greeting/index.js", () => ({
  onVisitorDetected,
}));
// The unauthorized-request path writes an audit row (recordAuthFailure ->
// auth_failure_log). Never let a test do that against a real database.
vi.mock("@platform/db", () => ({ recordAuthFailure }));
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
    showWelcomeScreenIfIdle.mockReset();
    showWelcomeScreenIfIdle.mockResolvedValue(true);
    onVisitorDetected.mockReset();
    onVisitorDetected.mockResolvedValue(undefined);
    recordAuthFailure.mockReset();
    recordAuthFailure.mockResolvedValue(undefined);
    flags.armed = false;
    flags.greeting = true;
    process.env["BROADCAST_SECRET"] = SECRET;
  });

  it("rejects a request without the shared secret", async () => {
    const res = await post({ type: "PRODUCT_DETECTED" }, null);
    expect(res.status).toBe(401);
    expect(applyProductDetection).not.toHaveBeenCalled();
    // The audit write went to the mock, not a database.
    expect(recordAuthFailure).toHaveBeenCalledWith(
      expect.objectContaining({ route: "internal/vision-event", reason: "unauthorized" })
    );
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
  describe("greeting wiring", () => {
    // The greeting module is import()ed lazily behind the flag, so its call lands a tick later.
    const settle = () => new Promise((r) => setTimeout(r, 25));

    const UUID = "3f2b8c1e-7a4d-4e6b-9c0a-1d2e3f4a5b6c";
    const visitorEvent = { type: "VISITOR_DETECTED", uuid: UUID, name: "", isNew: false, lastSeen: "", hasImage: false };

    it("greets a recognised visitor by uuid, and still relays to the CMS", async () => {
      flags.armed = true;
      const res = await post(visitorEvent);

      expect(res.status).toBe(200);
      expect(broadcastToCms).toHaveBeenCalledWith(expect.objectContaining({ uuid: UUID }));
      await vi.waitFor(() => expect(onVisitorDetected).toHaveBeenCalledWith(UUID, { eventLastSeen: "" }));
    });

    it("does not greet when the vision trigger is disarmed", async () => {
      flags.armed = false;
      await post(visitorEvent);
      await settle();
      expect(onVisitorDetected).not.toHaveBeenCalled();
      expect(broadcastToCms).toHaveBeenCalled();
    });

    it("does not greet when GREETING_ENABLED is off", async () => {
      flags.armed = true;
      flags.greeting = false;
      await post(visitorEvent);
      await settle();
      expect(onVisitorDetected).not.toHaveBeenCalled();
    });

    it("ignores a malformed uuid instead of sending it to the database", async () => {
      flags.armed = true;
      const res = await post({ ...visitorEvent, uuid: "not-a-uuid" });
      expect(res.status).toBe(200);
      await settle();
      expect(onVisitorDetected).not.toHaveBeenCalled();
    });

    it("never fails or delays the relay because a greeting failed", async () => {
      flags.armed = true;
      onVisitorDetected.mockRejectedValue(new Error("db down"));
      const res = await post(visitorEvent);
      expect(res.status).toBe(200);
      await settle();
    });

    it("passes the event's own timestamp along so a stale sighting can be ignored", async () => {
      flags.armed = true;
      const lastSeen = "2026-10-24T09:00:00.000Z";
      await post({ ...visitorEvent, lastSeen });
      await vi.waitFor(() => expect(onVisitorDetected).toHaveBeenCalledWith(UUID, { eventLastSeen: lastSeen }));
    });

    it("when disarmed it says so once, not once per sighting", async () => {
      flags.armed = false;
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      await post(visitorEvent);
      await post(visitorEvent);
      await post(visitorEvent);
      const disarmedLines = info.mock.calls.filter((c) => String(c[0]).includes("[greeting] disarmed"));
      info.mockRestore();
      // (module-level LogOnce: other tests in this file may already have logged it inside the 10 min window)
      expect(disarmedLines.length).toBeLessThanOrEqual(1);
    });

    it("PERSON_PRESENT does not touch the welcome screen while greetings are enabled", async () => {
      flags.armed = true;
      flags.greeting = true;
      const res = await post({ type: "PERSON_PRESENT", cameraId: "cam-entrance", count: 1 });
      expect(res.status).toBe(200);
      expect(showWelcomeScreenIfIdle).not.toHaveBeenCalled();
    });

    it("PERSON_PRESENT keeps the legacy welcome push when greetings are disabled", async () => {
      flags.armed = true;
      flags.greeting = false;
      await post({ type: "PERSON_PRESENT", cameraId: "cam-entrance", count: 1 });
      expect(showWelcomeScreenIfIdle).toHaveBeenCalledTimes(1);
    });

    it("PERSON_PRESENT does nothing when disarmed, greetings on or off", async () => {
      flags.armed = false;
      flags.greeting = false;
      await post({ type: "PERSON_PRESENT", cameraId: "cam-entrance", count: 1 });
      expect(showWelcomeScreenIfIdle).not.toHaveBeenCalled();
    });
  });

  describe("body size limit", () => {
    it("rejects a body over ~2 MB with 413 before doing anything with it", async () => {
      const big = "x".repeat(2 * 1024 * 1024 + 1024);
      const res = await post({ type: "CAMERA_SNAPSHOT", cameraId: "cam", jpegBase64: big });
      expect(res.status).toBe(413);
      expect(broadcastToCms).not.toHaveBeenCalled();
    });

    it("still accepts a realistic snapshot-sized body", async () => {
      const res = await post({ type: "CAMERA_SNAPSHOT", cameraId: "cam", jpegBase64: "x".repeat(150 * 1024) });
      expect(res.status).toBe(200);
    });
  });
});
