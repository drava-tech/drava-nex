import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Real guards and the real ownership rule (isMediaOwnedBy from @platform/db);
// only the session and the database reads/writes are faked.
const session = vi.hoisted(() => ({ user: null as null | { id: string; role: string; email: string; name: string } }));
vi.mock("../src/lib/auth.js", () => ({
  auth: { api: { getSession: vi.fn(async () => (session.user ? { user: session.user } : null)) } },
}));
const db = vi.hoisted(() => ({
  listMediaAssets: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
  listMediaAssetsCursor: vi.fn(async () => ({ items: [], nextCursor: null })),
  getMediaLibraryStats: vi.fn(async () => ({ total: 0, totalBytes: 0, byType: [], recentCount: 0, recent: [] })),
  getMediaAsset: vi.fn(),
  softDeleteMediaAsset: vi.fn(),
  markMediaSaved: vi.fn(),
  createMediaAsset: vi.fn(),
}));
vi.mock("@platform/db", async (importOriginal) => ({ ...(await importOriginal<typeof import("@platform/db")>()), ...db }));
vi.mock("../src/ws/gateway.js", () => ({ broadcastToCms: vi.fn() }));
vi.mock("../src/services/gmail-ingest.js", () => ({ runGmailLoad: vi.fn(async () => ({ added: 0 })) }));
vi.mock("../src/services/thumbnails.js", () => ({ generateThumbnail: vi.fn() }));

import { isMediaOwnedBy } from "@platform/db";
import { mediaRouter, uploadRouter } from "../src/routes/media.js";

const app = new Hono().route("/api/media", mediaRouter).route("/api/upload", uploadRouter);
const asUser = () => (session.user = { id: "u1", role: "GUEST", email: "priya_s@x.com", name: "Priya" });
const asAdmin = () => (session.user = { id: "a1", role: "ADMIN", email: "admin@x.com", name: "Admin" });

const mine = { id: "m1", url: "https://youtu.be/x", uploadedByUserId: "u1", source: "upload", emailFrom: null };
const emailedByMe = { id: "m2", url: "https://example.com/a.pdf", uploadedByUserId: null, source: "email", emailFrom: "Priya <Priya_S@x.com>" };
const someoneElses = { id: "m3", url: "https://example.com/b.png", uploadedByUserId: "boss", source: "upload", emailFrom: null };

beforeEach(() => {
  session.user = null;
  for (const fn of Object.values(db)) fn.mockClear();
});

describe("isMediaOwnedBy", () => {
  const owner = { userId: "u1", email: "priya_s@x.com" };
  it("counts uploads and emails from their address, nothing else", () => {
    expect(isMediaOwnedBy(mine as never, owner)).toBe(true);
    expect(isMediaOwnedBy(emailedByMe as never, owner)).toBe(true);
    expect(isMediaOwnedBy(someoneElses as never, owner)).toBe(false);
    // "_" is a plain character here, not a wildcard.
    expect(isMediaOwnedBy({ ...emailedByMe, emailFrom: "priyaXs@x.com" } as never, owner)).toBe(false);
  });
});

describe("media for a User", () => {
  it("lists only their own media; an admin's listing is unscoped", async () => {
    asUser();
    await app.request("/api/media?mode=cursor");
    expect(db.listMediaAssetsCursor).toHaveBeenLastCalledWith(expect.anything(), { userId: "u1", email: "priya_s@x.com" });
    await app.request("/api/media/stats");
    expect(db.getMediaLibraryStats).toHaveBeenLastCalledWith(expect.anything(), 4, { userId: "u1", email: "priya_s@x.com" });
    asAdmin();
    await app.request("/api/media");
    expect(db.listMediaAssets).toHaveBeenLastCalledWith(expect.anything(), null);
  });

  it("can delete their own media but gets 'not found' for anyone else's", async () => {
    asUser();
    db.getMediaAsset.mockResolvedValueOnce(someoneElses);
    expect((await app.request("/api/media?id=m3", { method: "DELETE" })).status).toBe(404);
    expect(db.softDeleteMediaAsset).not.toHaveBeenCalled();
    db.getMediaAsset.mockResolvedValueOnce(emailedByMe);
    expect((await app.request("/api/media?id=m2", { method: "DELETE" })).status).toBe(200);
    expect(db.softDeleteMediaAsset).toHaveBeenCalledWith("m2");
  });

  it("can bring media in: email, links and uploads", async () => {
    asUser();
    expect((await app.request("/api/media/gmail/load", { method: "POST" })).status).toBe(200);
    db.createMediaAsset.mockResolvedValueOnce({ ...mine, type: "youtube", name: "x", pendingSave: false, createdAt: new Date() });
    const link = await app.request("/api/media/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://youtu.be/dQw4w9WgXcQ" }),
    });
    expect(link.status).toBe(200);
    expect(db.createMediaAsset).toHaveBeenCalledWith(expect.objectContaining({ uploadedByUserId: "u1" }));
    // The upload route lets a User in (it fails here only because no file is sent).
    expect((await app.request("/api/upload", { method: "POST", body: new FormData() })).status).toBe(400);
  });

  it("refuses anyone signed out", async () => {
    expect((await app.request("/api/media")).status).toBe(401);
    expect((await app.request("/api/upload", { method: "POST", body: new FormData() })).status).toBe(401);
  });
});
