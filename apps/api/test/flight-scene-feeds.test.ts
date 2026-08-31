import { Hono } from "hono";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { flightSimulationRouter } from "../src/routes/flight-simulation.js";
import { resolveLocation } from "../src/services/flight-locations.js";
import { presignR2Get, readR2Config, resolveVideoKey } from "../src/services/flight-video.js";

// The scene feeds are the Flight Garden's live half: weather and attendance are
// third-party APIs behind a key, and the garden video is a private R2 object.
// All three are proxied so no credential reaches the browser — these tests pin
// that boundary, plus the two allowlists that stop the proxies being turned
// into open relays.

const app = new Hono().route("/api/flight-simulation", flightSimulationRouter);
const get = (path: string) => app.request(`/api/flight-simulation${path}`);

const R2_ENV = {
  FLIGHT_R2_ACCESS_KEY_ID: "test-access-key",
  FLIGHT_R2_SECRET_ACCESS_KEY: "test-secret-key",
  FLIGHT_R2_BUCKET: "test-bucket",
  FLIGHT_R2_ENDPOINT: "https://account.r2.cloudflarestorage.com/test-bucket",
  FLIGHT_R2_REGION: "auto",
} as const;

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("weather location allowlist", () => {
  it("resolves an allowlisted id to its query", () => {
    expect(resolveLocation("oslo")).toEqual({ label: "Oslo, Norway", query: "Oslo" });
  });

  it("falls back to the default when no id is given", () => {
    expect(resolveLocation(undefined)?.query).toBe("Bengaluru");
  });

  it("refuses an id that is not on the list", () => {
    expect(resolveLocation("atlantis")).toBeNull();
  });

  it("cannot be walked onto Object.prototype keys", () => {
    // A plain `LOCATIONS[id]` lookup would return a function here and sail past
    // the null check, so the endpoint must not be reachable this way.
    expect(resolveLocation("constructor")).toBeNull();
    expect(resolveLocation("toString")).toBeNull();
  });
});

describe("video id allowlist", () => {
  it("resolves an allowlisted id to an object key", () => {
    expect(resolveVideoKey("flight-garden")).toBe("flight-simulation/4k_render_final_001.mp4");
  });

  it("falls back to the default render when no id is given", () => {
    expect(resolveVideoKey(undefined)).toBe("flight-simulation/4k_render_final_001.mp4");
  });

  it("refuses an arbitrary key — ids go in, keys come out", () => {
    // The whole point of the allowlist: without it, anyone holding the endpoint
    // URL could mint a signed link to any object in the bucket.
    expect(resolveVideoKey("secrets/customer-list.csv")).toBeNull();
    expect(resolveVideoKey("constructor")).toBeNull();
  });
});

describe("R2 presigning", () => {
  beforeEach(() => {
    Object.assign(process.env, R2_ENV);
  });

  it("reads its configuration from the environment", () => {
    expect(readR2Config()).toEqual({
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
      bucket: "test-bucket",
      endpoint: "https://account.r2.cloudflarestorage.com/test-bucket",
      region: "auto",
    });
  });

  it("treats a partially configured bucket as unconfigured", () => {
    delete process.env["FLIGHT_R2_SECRET_ACCESS_KEY"];
    expect(readR2Config()).toBeNull();
  });

  it("signs a URL carrying every parameter R2 verifies", () => {
    const url = presignR2Get(readR2Config()!, "flight-simulation/clip.mp4", 3600);
    const parsed = new URL(url);

    expect(parsed.host).toBe("account.r2.cloudflarestorage.com");
    expect(parsed.pathname).toBe("/test-bucket/flight-simulation/clip.mp4");
    expect(parsed.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(parsed.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never leaks the secret key into the signed URL", () => {
    const url = presignR2Get(readR2Config()!, "flight-simulation/clip.mp4");
    expect(url).not.toContain("test-secret-key");
    // The access key id is public by design and travels in X-Amz-Credential.
    expect(url).toContain("test-access-key");
  });

  it("encodes the cache-control override without a space", () => {
    // URLSearchParams renders a space as "+", but SigV4's canonical query
    // requires %20 — a space here fails as SignatureDoesNotMatch against R2.
    const url = presignR2Get(readR2Config()!, "flight-simulation/clip.mp4");
    expect(url).toContain("response-cache-control=public%2Cmax-age%3D3600");
    expect(url).not.toContain("public%2C+max-age");
  });
});

describe("GET /api/flight-simulation/garden-video", () => {
  it("redirects to a presigned URL when R2 is configured", async () => {
    Object.assign(process.env, R2_ENV);

    const res = await get("/garden-video?id=flight-garden");
    expect(res.status).toBe(302);

    const location = res.headers.get("location") ?? "";
    expect(location).toContain("account.r2.cloudflarestorage.com");
    expect(location).toContain("X-Amz-Signature=");
    // Never the credential itself, however the redirect is built.
    expect(location).not.toContain("test-secret-key");
  });

  it("refuses an id that is not allowlisted", async () => {
    Object.assign(process.env, R2_ENV);

    const res = await get("/garden-video?id=../../etc/passwd");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("UNKNOWN_VIDEO");
  });

  it("reports an unconfigured bucket instead of failing opaquely", async () => {
    for (const key of Object.keys(R2_ENV)) delete process.env[key];

    const res = await get("/garden-video?id=flight-garden");
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("NOT_CONFIGURED");
  });
});

describe("GET /api/flight-simulation/wind", () => {
  it("returns the reading in the standard envelope", async () => {
    process.env["WEATHERAPI_KEY"] = "test-weather-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          current: { wind_kph: 21.6, temp_c: 27.4, condition: { text: "Partly cloudy" } },
        })
      )
    );

    const res = await get("/wind?location=oslo");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ kph: 21.6, tempC: 27.4, condition: "Partly cloudy" });
  });

  it("keeps the API key server-side and sends only the allowlisted query", async () => {
    process.env["WEATHERAPI_KEY"] = "test-weather-key";
    const fetchMock = vi.fn(async () => Response.json({ current: { wind_kph: 4 } }));
    vi.stubGlobal("fetch", fetchMock);

    await get("/wind?location=tokyo");

    const called = String(fetchMock.mock.calls[0]?.[0]);
    expect(called).toContain("q=Tokyo");
    expect(called).toContain("key=test-weather-key");
  });

  it("refuses a location that is not allowlisted, without calling the provider", async () => {
    process.env["WEATHERAPI_KEY"] = "test-weather-key";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await get("/wind?location=atlantis");
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a missing key as unconfigured rather than crashing", async () => {
    delete process.env["WEATHERAPI_KEY"];

    const res = await get("/wind");
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("NOT_CONFIGURED");
  });

  it("surfaces a provider outage as a 502", async () => {
    process.env["WEATHERAPI_KEY"] = "test-weather-key";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));

    const res = await get("/wind");
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("UPSTREAM_FAILED");
  });
});

describe("GET /api/flight-simulation/attendance", () => {
  beforeEach(() => {
    process.env["TRAVA_ATTENDANCE_API_URL"] = "https://trava.example/api/attendance";
    process.env["TRAVA_ATTENDANCE_WORKSPACE_ID"] = "ws-1";
    process.env["TRAVA_ATTENDANCE_API_KEY"] = "test-trava-key";
  });

  it("returns only the three counts the scene reads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          // halfDay/onLeave belong to neither present, absent nor late, so they
          // must not be folded into the reading.
          data: { present: 12, absent: 3, late: 2, halfDay: 1, onLeave: 4 },
        })
      )
    );

    const res = await get("/attendance");
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ present: 12, absent: 3, late: 2 });
  });

  it("sends the key as a bearer token and never exposes it to the caller", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ success: true, data: { present: 1, absent: 0, late: 0 } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await get("/attendance");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-trava-key");
    expect(await res.text()).not.toContain("test-trava-key");
  });

  it("reports missing configuration as unconfigured", async () => {
    delete process.env["TRAVA_ATTENDANCE_API_URL"];

    const res = await get("/attendance");
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("NOT_CONFIGURED");
  });

  it("rejects a response missing a count rather than reporting a partial reading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true, data: { present: 5, absent: 1 } }))
    );

    const res = await get("/attendance");
    expect(res.status).toBe(502);
  });
});
