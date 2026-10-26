import { beforeEach, describe, expect, it, vi } from "vitest";

const { getGreetingStatus, persistArmedState, flags, armedState, admin } = vi.hoisted(() => ({
  getGreetingStatus: vi.fn(),
  persistArmedState: vi.fn(),
  flags: { greeting: false },
  armedState: { armed: true },
  admin: { allow: true },
}));

vi.mock("../src/lib/greeting-flag.js", () => ({ isGreetingEnabled: () => flags.greeting }));
vi.mock("../src/services/greeting/index.js", () => ({ getGreetingStatus, persistArmedState }));
vi.mock("../src/services/door-screen-trigger.js", () => ({
  isVisionTriggerArmed: () => armedState.armed,
  setVisionTriggerArmed: (v: boolean) => void (armedState.armed = v),
}));
vi.mock("../src/middleware/auth.js", () => ({
  requireAdmin: async (c: { json: (b: unknown, s: number) => Response }, next: () => Promise<void>) =>
    admin.allow ? next() : c.json({ success: false }, 403),
}));

const { greetingRouter } = await import("../src/routes/greeting.js");
const { visionTriggerRouter } = await import("../src/routes/vision-trigger.js");

const settle = () => new Promise((r) => setTimeout(r, 25));

beforeEach(() => {
  vi.clearAllMocks();
  flags.greeting = false;
  armedState.armed = true;
  admin.allow = true;
  getGreetingStatus.mockResolvedValue({ enabled: true, armed: true });
  persistArmedState.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/greeting/status", () => {
  it("is admin only", async () => {
    admin.allow = false;
    flags.greeting = true;
    const res = await greetingRouter.request("/status");
    expect(res.status).toBe(403);
    expect(getGreetingStatus).not.toHaveBeenCalled();
  });

  it("with greetings off it answers { enabled: false } and loads nothing", async () => {
    armedState.armed = false;
    const res = await greetingRouter.request("/status");
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ enabled: false, armed: false });
    expect(getGreetingStatus).not.toHaveBeenCalled();
  });

  it("with greetings on it returns the service's status", async () => {
    flags.greeting = true;
    getGreetingStatus.mockResolvedValue({ enabled: true, armed: true, voice: "screen", today: { greeted: 3 } });
    const res = await greetingRouter.request("/status");
    expect((await res.json()).data).toMatchObject({ enabled: true, today: { greeted: 3 } });
  });

  it("a failure is a clean 500, not a crash", async () => {
    flags.greeting = true;
    getGreetingStatus.mockRejectedValue(new Error("boom"));
    const res = await greetingRouter.request("/status");
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("INTERNAL");
  });
});

describe("POST /api/vision-trigger — the arm switch survives a restart only while greetings are on", () => {
  const post = (armed: boolean) =>
    visionTriggerRouter.request("/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ armed }) });

  it("off (today's behaviour): in-memory only, nothing is persisted or loaded", async () => {
    const res = await post(false);
    await settle();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ armed: false });
    expect(armedState.armed).toBe(false);
    expect(persistArmedState).not.toHaveBeenCalled();
  });

  it("on: the new state is persisted", async () => {
    flags.greeting = true;
    await post(false);
    await vi.waitFor(() => expect(persistArmedState).toHaveBeenCalledWith(false));
    await post(true);
    await vi.waitFor(() => expect(persistArmedState).toHaveBeenLastCalledWith(true));
  });

  it("on: a failure to persist never changes the response", async () => {
    flags.greeting = true;
    persistArmedState.mockRejectedValue(new Error("table missing"));
    const res = await post(false);
    await settle();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ armed: false });
  });

  it("GET still reports the in-memory state", async () => {
    armedState.armed = false;
    const res = await visionTriggerRouter.request("/");
    expect((await res.json()).data).toEqual({ armed: false });
  });
});
