import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  listUsers: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserById: vi.fn(),
  setUserRole: vi.fn(),
  deleteUserById: vi.fn(),
  deleteUserSessions: vi.fn(),
}));
const authMock = vi.hoisted(() => ({
  session: null as null | { user: { id: string; role: string; name: string; email: string } },
  signUpEmail: vi.fn(),
  hash: vi.fn(async (p: string) => `hashed:${p}`),
  updatePassword: vi.fn(),
}));

vi.mock("@platform/db", () => db);
vi.mock("../src/lib/auth.js", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => authMock.session),
      signUpEmail: authMock.signUpEmail,
    },
    $context: Promise.resolve({
      password: { hash: authMock.hash },
      internalAdapter: { updatePassword: authMock.updatePassword },
    }),
  },
}));

import { usersRouter } from "../src/routes/users.js";

const app = new Hono().route("/api/users", usersRouter);
const as = (role: string, id = "me") => {
  authMock.session = { user: { id, role, name: "Me", email: "me@x.com" } };
};
const req = (method: string, path: string, body?: unknown) =>
  // "/" means the collection itself: /api/users, as the CMS calls it (no trailing slash).
  app.request(`/api/users${path === "/" ? "" : path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  authMock.signUpEmail.mockReset();
  authMock.updatePassword.mockReset();
  authMock.session = null;
});

describe("/api/users", () => {
  it("is for the super admin only", async () => {
    expect((await req("GET", "/")).status).toBe(401);
    as("GUEST");
    expect((await req("GET", "/")).status).toBe(403);
    as("ADMIN");
    expect((await req("GET", "/")).status).toBe(403);
    as("SUPERADMIN");
    db.listUsers.mockResolvedValue([]);
    expect((await req("GET", "/")).status).toBe(200);
  });

  it("adds a user, who stays a GUEST (shown as User)", async () => {
    as("SUPERADMIN");
    db.getUserByEmail.mockResolvedValue(null);
    authMock.signUpEmail.mockResolvedValue({ user: { id: "new-1" } });
    const res = await req("POST", "/", { name: "Priya", email: "Priya@X.com", password: "longenough", role: "GUEST" });
    expect(res.status).toBe(201);
    expect(authMock.signUpEmail).toHaveBeenCalledWith({
      body: { email: "priya@x.com", password: "longenough", name: "Priya" },
    });
    expect(db.setUserRole).not.toHaveBeenCalled();
  });

  it("adds an admin", async () => {
    as("SUPERADMIN");
    db.getUserByEmail.mockResolvedValue(null);
    authMock.signUpEmail.mockResolvedValue({ user: { id: "new-2" } });
    await req("POST", "/", { name: "Ravi", email: "ravi@x.com", password: "longenough", role: "ADMIN" });
    expect(db.setUserRole).toHaveBeenCalledWith("new-2", "ADMIN");
  });

  it("refuses a second super admin, a short password and a taken email", async () => {
    as("SUPERADMIN");
    expect((await req("POST", "/", { name: "A", email: "a@x.com", password: "longenough", role: "SUPERADMIN" })).status).toBe(400);
    const short = await req("POST", "/", { name: "A", email: "a@x.com", password: "short", role: "GUEST" });
    expect(short.status).toBe(400);
    expect((await short.json()).error.message).toMatch(/8 characters/);
    db.getUserByEmail.mockResolvedValue({ id: "x" });
    expect((await req("POST", "/", { name: "A", email: "a@x.com", password: "longenough", role: "GUEST" })).status).toBe(409);
    expect(authMock.signUpEmail).not.toHaveBeenCalled();
  });

  it("changes a role and signs them out so it applies", async () => {
    as("SUPERADMIN");
    db.getUserById.mockResolvedValue({ id: "u1", role: "GUEST" });
    expect((await req("PATCH", "/u1", { role: "ADMIN" })).status).toBe(200);
    expect(db.setUserRole).toHaveBeenCalledWith("u1", "ADMIN");
    expect(db.deleteUserSessions).toHaveBeenCalledWith("u1");
  });

  it("won't change or remove the super admin, or yourself", async () => {
    as("SUPERADMIN", "me");
    db.getUserById.mockResolvedValue({ id: "boss", role: "SUPERADMIN" });
    expect((await req("PATCH", "/boss", { role: "GUEST" })).status).toBe(403);
    expect((await req("DELETE", "/boss")).status).toBe(403);
    expect((await req("DELETE", "/me")).status).toBe(403);
    expect(db.deleteUserById).not.toHaveBeenCalled();
  });

  it("resets a password, hashed, and signs them out everywhere", async () => {
    as("SUPERADMIN");
    db.getUserById.mockResolvedValue({ id: "u1", role: "GUEST" });
    expect((await req("POST", "/u1/password", { password: "brandnewpass" })).status).toBe(200);
    expect(authMock.updatePassword).toHaveBeenCalledWith("u1", "hashed:brandnewpass");
    expect(db.deleteUserSessions).toHaveBeenCalledWith("u1");
  });

  it("removes a user", async () => {
    as("SUPERADMIN");
    db.getUserById.mockResolvedValue({ id: "u1", role: "ADMIN" });
    expect((await req("DELETE", "/u1")).status).toBe(200);
    expect(db.deleteUserById).toHaveBeenCalledWith("u1");
  });
});
