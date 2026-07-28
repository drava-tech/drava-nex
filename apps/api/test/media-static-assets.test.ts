import { Hono } from "hono";
import { describe, it, expect } from "vitest";

import { mediaFilesRouter } from "../src/routes/media.js";

// Covers the allowlisted static-asset subdirectory routes added for code-shipped
// template assets (3D models + the DRACO decoder). The flat /media/:filename
// scheme can't serve these: three's DRACOLoader resolves sibling files by
// hardcoded name, so the decoder must keep its own folder.
const app = new Hono().route("/media", mediaFilesRouter);

const head = (path: string) => app.request(path);

describe("GET /media/<dir>/<file>", () => {
  it("serves a GLB from the allowlisted flight-garden directory", async () => {
    const res = await head("/media/flight-garden/GROUND2.glb");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("model/gltf-binary");
    expect(Number(res.headers.get("content-length"))).toBeGreaterThan(0);
  });

  it("marks code-shipped assets immutable so screens don't re-download them", async () => {
    const res = await head("/media/flight-garden/GROUND2.glb");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("serves the image fallback texture with its real type", async () => {
    const res = await head("/media/flight-garden/garden.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("supports range requests (large geometry must stay seekable)", async () => {
    const res = await app.request("/media/flight-garden/GROUND2.glb", {
      headers: { range: "bytes=0-99" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-length")).toBe("100");
  });

  it("404s a file that isn't there", async () => {
    expect((await head("/media/flight-garden/does-not-exist.glb")).status).toBe(404);
  });

  it("404s a directory that isn't allowlisted", async () => {
    expect((await head("/media/secrets/garden.png")).status).toBe(404);
  });
});

describe("GET /media/<dir>/<sub>/<file> — DRACO decoder", () => {
  it("serves the wasm decoder with the correct type", async () => {
    const res = await head("/media/flight-garden/draco/draco_decoder.wasm");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/wasm");
  });

  it("serves the wasm wrapper as javascript", async () => {
    const res = await head("/media/flight-garden/draco/draco_wasm_wrapper.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript");
  });

  it("404s a non-allowlisted nested directory", async () => {
    expect((await head("/media/nope/draco/draco_decoder.wasm")).status).toBe(404);
  });
});

describe("path traversal", () => {
  it("cannot escape the media directory through either segment", async () => {
    for (const attempt of [
      "/media/flight-garden/..%2F..%2F..%2Fpackage.json",
      "/media/..%2F..%2Fpackage.json",
      "/media/flight-garden/draco/..%2F..%2F..%2Fpackage.json",
    ]) {
      const res = await head(attempt);
      expect(res.status, `expected non-200 for ${attempt}`).not.toBe(200);
    }
  });
});
