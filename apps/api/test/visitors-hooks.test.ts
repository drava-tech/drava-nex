import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PATCH /api/visitors/:uuid and POST /api/visitors/:uuid/merge — the greeting
 * hooks. The two things that matter: with the flag OFF these routes are exactly
 * what they were (the original single UPDATE, no greeting code touched), and
 * with it ON nothing a greeting does — however badly it fails — can change the
 * response of an already-committed rename or merge.
 */

const U = "3f2b8c1e-7a4d-4e6b-9c0a-1d2e3f4a5b6c";
const T = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const { updateVisitorContact, updateVisitorContactWithPrevious, mergeVisitor, greeting, flags } = vi.hoisted(() => ({
  updateVisitorContact: vi.fn(),
  updateVisitorContactWithPrevious: vi.fn(),
  mergeVisitor: vi.fn(),
  greeting: {
    onVisitorRenamed: vi.fn(),
    onVisitorMerged: vi.fn(),
    invalidateVisitor: vi.fn(),
  },
  flags: { greeting: false, armed: true },
}));

class VisitorNotFoundError extends Error {}
class InvalidVisitorMergeError extends Error {}

vi.mock("@platform/db", () => ({
  listVisitors: vi.fn(),
  getVisitorImage: vi.fn(),
  listVisitorPhotos: vi.fn(),
  getVisitorPhoto: vi.fn(),
  deleteVisitorPhoto: vi.fn(),
  updateVisitorContact,
  updateVisitorContactWithPrevious,
  mergeVisitor,
  VisitorNotFoundError,
  InvalidVisitorMergeError,
}));
vi.mock("../src/middleware/auth.js", () => ({
  requireAdmin: async (_c: unknown, next: () => Promise<void>) => next(),
}));
vi.mock("../src/lib/greeting-flag.js", () => ({ isGreetingEnabled: () => flags.greeting }));
vi.mock("../src/services/door-screen-trigger.js", () => ({ isVisionTriggerArmed: () => flags.armed }));
vi.mock("../src/services/greeting/index.js", () => greeting);

const { visitorsRouter } = await import("../src/routes/visitors.js");

const row = (name: string) => ({
  uuid: U,
  name,
  email: "",
  role: "guest",
  imagePath: null,
  userId: null,
  firstSeen: new Date("2026-10-01T00:00:00Z"),
  lastSeen: new Date("2026-10-24T09:00:00Z"),
});
const item = (name: string) => ({
  uuid: U,
  name,
  email: "",
  role: "guest",
  hasImage: false,
  firstSeen: "2026-10-01T00:00:00.000Z",
  lastSeen: "2026-10-24T09:00:00.000Z",
});

const patch = (body: unknown, uuid = U) =>
  visitorsRouter.request(`/${uuid}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const merge = (targetUuid = T) =>
  visitorsRouter.request(`/${U}/merge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetUuid }) });
const settle = () => new Promise((r) => setTimeout(r, 25));

beforeEach(() => {
  vi.clearAllMocks();
  flags.greeting = false;
  flags.armed = true;
  for (const fn of Object.values(greeting)) fn.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("PATCH /:uuid with GREETING_ENABLED off (the default)", () => {
  it("uses the original single UPDATE and returns the same body", async () => {
    updateVisitorContact.mockResolvedValue(row("Priya"));

    const res = await patch({ name: "Priya" });

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(item("Priya"));
    expect(updateVisitorContact).toHaveBeenCalledWith(U, { name: "Priya" });
    expect(updateVisitorContactWithPrevious).not.toHaveBeenCalled();
  });

  it("never touches the greeting code, even for a blank -> named rename", async () => {
    updateVisitorContact.mockResolvedValue(row("Priya"));
    await patch({ name: "Priya" });
    await settle();
    for (const fn of Object.values(greeting)) expect(fn).not.toHaveBeenCalled();
  });

  it("keeps its error mapping", async () => {
    updateVisitorContact.mockRejectedValue(new VisitorNotFoundError("nope"));
    expect((await patch({ name: "Priya" })).status).toBe(404);
  });
});

describe("PATCH /:uuid with GREETING_ENABLED on", () => {
  beforeEach(() => {
    flags.greeting = true;
  });

  it("returns the same body as the flag-off path", async () => {
    updateVisitorContactWithPrevious.mockResolvedValue({ visitor: row("Priya"), previousName: "" });
    const res = await patch({ name: "Priya" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(item("Priya"));
  });

  it("blank -> named, armed: greets (once, by uuid)", async () => {
    updateVisitorContactWithPrevious.mockResolvedValue({ visitor: row("Priya"), previousName: "   " });
    await patch({ name: "Priya" });
    await vi.waitFor(() => expect(greeting.onVisitorRenamed).toHaveBeenCalledWith(U));
    expect(greeting.onVisitorRenamed).toHaveBeenCalledTimes(1);
    expect(greeting.invalidateVisitor).not.toHaveBeenCalled();
  });

  it("blank -> named while DISARMED: no greeting, but the cached answer is dropped", async () => {
    flags.armed = false;
    updateVisitorContactWithPrevious.mockResolvedValue({ visitor: row("Priya"), previousName: "" });
    await patch({ name: "Priya" });
    await vi.waitFor(() => expect(greeting.invalidateVisitor).toHaveBeenCalledWith(U));
    expect(greeting.onVisitorRenamed).not.toHaveBeenCalled();
  });

  it.each([
    ["fixing a name (named -> named)", "Priyaa", "Priya"],
    ["clearing a name", "", "Priya"],
    ["an email-only edit that leaves it blank", "", ""],
  ])("%s never greets", async (_label, newName, previousName) => {
    updateVisitorContactWithPrevious.mockResolvedValue({ visitor: row(newName), previousName });
    const res = await patch({ name: newName });
    await settle();
    expect(res.status).toBe(200);
    expect(greeting.onVisitorRenamed).not.toHaveBeenCalled();
  });

  it("a greeting that fails or throws can never change the response", async () => {
    updateVisitorContactWithPrevious.mockResolvedValue({ visitor: row("Priya"), previousName: "" });

    greeting.onVisitorRenamed.mockRejectedValue(new Error("db down"));
    let res = await patch({ name: "Priya" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(item("Priya"));
    await settle();

    greeting.onVisitorRenamed.mockReset().mockImplementation(() => {
      throw new Error("threw synchronously");
    });
    res = await patch({ name: "Priya" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(item("Priya"));
    await settle();
  });

  it("an update that fails is still reported, and no greeting is attempted", async () => {
    updateVisitorContactWithPrevious.mockRejectedValue(new VisitorNotFoundError("nope"));
    expect((await patch({ name: "Priya" })).status).toBe(404);
    await settle();
    expect(greeting.onVisitorRenamed).not.toHaveBeenCalled();
  });
});

describe("POST /:uuid/merge", () => {
  it("flag off: returns the merged visitor and touches no greeting code", async () => {
    mergeVisitor.mockResolvedValue(row("Priya"));
    const res = await merge();
    await settle();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(item("Priya"));
    expect(mergeVisitor).toHaveBeenCalledWith(U, T);
    for (const fn of Object.values(greeting)) expect(fn).not.toHaveBeenCalled();
  });

  it("flag on, armed: greets the TARGET visitor after the merge", async () => {
    flags.greeting = true;
    mergeVisitor.mockResolvedValue(row("Priya"));
    await merge();
    await vi.waitFor(() => expect(greeting.onVisitorMerged).toHaveBeenCalledWith(T));
  });

  it("flag on, disarmed: no greeting, cache dropped for the target", async () => {
    flags.greeting = true;
    flags.armed = false;
    mergeVisitor.mockResolvedValue(row("Priya"));
    await merge();
    await vi.waitFor(() => expect(greeting.invalidateVisitor).toHaveBeenCalledWith(T));
    expect(greeting.onVisitorMerged).not.toHaveBeenCalled();
  });

  it("a greeting that fails or throws can never change the response of a committed merge", async () => {
    flags.greeting = true;
    mergeVisitor.mockResolvedValue(row("Priya"));

    greeting.onVisitorMerged.mockRejectedValue(new Error("db down"));
    let res = await merge();
    expect(res.status).toBe(200);
    await settle();

    greeting.onVisitorMerged.mockReset().mockImplementation(() => {
      throw new Error("threw synchronously");
    });
    res = await merge();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual(item("Priya"));
    await settle();
  });

  it("a merge that fails keeps its error mapping and greets nobody", async () => {
    flags.greeting = true;
    mergeVisitor.mockRejectedValue(new InvalidVisitorMergeError("same visitor"));
    expect((await merge()).status).toBe(422);
    mergeVisitor.mockRejectedValue(new VisitorNotFoundError("gone"));
    expect((await merge()).status).toBe(404);
    await settle();
    expect(greeting.onVisitorMerged).not.toHaveBeenCalled();
  });
});
