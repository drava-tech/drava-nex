import { beforeEach, describe, expect, it, vi } from "vitest";

// Real guards (src/middleware/auth.ts), with only the session faked: a User
// (GUEST) runs the room but can't change what a room mode does.
const session = vi.hoisted(() => ({ role: null as string | null }));
vi.mock("../src/lib/auth.js", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () =>
        session.role ? { user: { id: "u", name: "U", email: "u@x.com", role: session.role } } : null
      ),
    },
  },
}));
const modes = vi.hoisted(() => ({
  getAmbientMode: vi.fn(async (key: string) => ({ key, label: key })),
  listAmbientModes: vi.fn(async () => []),
  applyAmbientMode: vi.fn(async () => ({ applied: 3, failed: 0 })),
}));
vi.mock("../src/services/ambient-modes.js", () => modes);
vi.mock("@platform/db", () => ({ updateAmbientMode: vi.fn(async () => ({ key: "meeting" })) }));

import { ambientModesRouter } from "../src/routes/ambient-modes.js";

const call = (method: string, path: string, body?: unknown) =>
  ambientModesRouter.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  session.role = null;
  modes.applyAmbientMode.mockClear();
});

describe("environment permissions", () => {
  it("lets a User see and apply room modes", async () => {
    session.role = "GUEST";
    expect((await call("GET", "/")).status).toBe(200);
    expect((await call("POST", "/meeting/apply")).status).toBe(200);
    expect(modes.applyAmbientMode).toHaveBeenCalled();
  });

  it("doesn't let a User change what a mode does", async () => {
    session.role = "GUEST";
    expect((await call("PUT", "/meeting", { brightness: 40 })).status).toBe(403);
  });

  it("lets an admin change a mode", async () => {
    session.role = "ADMIN";
    expect((await call("PUT", "/meeting", { brightness: 40 })).status).toBe(200);
  });

  it("refuses anyone signed out", async () => {
    expect((await call("POST", "/meeting/apply")).status).toBe(401);
  });
});
