import { Hono } from "hono";
import { describe, it, expect, afterEach, vi } from "vitest";

import { dataArtStudioRouter, isStudioVideoName } from "../src/routes/data-art-studio.js";
import { CLOCK_LOCATION_IDS, resolveClockLocation } from "../src/services/data-art-locations.js";
// The studio's own city list, which this API's allowlist must mirror.
import { LOCATIONS, MAX_PLACES } from "../../../packages/data-art-studio/world-clock/locations.js";

// The Data Art Studio's data routes replace its standalone Vercel functions.
// They keep those functions' bare-JSON contract (the ported pages parse it
// unchanged) and the same allowlists, so no proxy becomes an open relay.

const app = new Hono().route("/api/data-art-studio", dataArtStudioRouter);
const get = (path: string) => app.request(`/api/data-art-studio${path}`);

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

function mockFetchJson(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    // A fresh Response per call: a body can only be read once.
    .mockImplementation(async () => new Response(JSON.stringify(body), { status }));
}

describe("World Clock location allowlist", () => {
  it("mirrors the studio's own city list exactly", () => {
    expect([...CLOCK_LOCATION_IDS].sort()).toEqual(
      (LOCATIONS as { id: string }[]).map((l) => l.id).sort()
    );
    expect(MAX_PLACES).toBe(5);
  });

  it("refuses ids that are not on the list, including prototype keys", () => {
    expect(resolveClockLocation("london")).toBe("London, United Kingdom");
    expect(resolveClockLocation("atlantis")).toBeNull();
    expect(resolveClockLocation("constructor")).toBeNull();
  });
});

describe("GET /wind", () => {
  it("returns the studio's bare { kph, tempC, condition } shape", async () => {
    process.env["WEATHERAPI_KEY"] = "k";
    mockFetchJson({ current: { wind_kph: 12.5, temp_c: 27, condition: { text: "Sunny" } } });

    const res = await get("/wind?location=oslo");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kph: 12.5, tempC: 27, condition: "Sunny" });
  });

  it("refuses an unknown location without calling upstream", async () => {
    process.env["WEATHERAPI_KEY"] = "k";
    const fetchSpy = mockFetchJson({});
    const res = await get("/wind?location=atlantis");
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a missing key as an { error }", async () => {
    delete process.env["WEATHERAPI_KEY"];
    const res = await get("/wind");
    expect(res.status).toBe(503);
    expect(await res.json()).toHaveProperty("error");
  });
});

describe("GET /weather", () => {
  it("returns one reading per id", async () => {
    process.env["WEATHERAPI_KEY"] = "k";
    mockFetchJson({
      location: { tz_id: "Europe/London" },
      current: { wind_kph: 8, temp_c: 14, condition: { text: "Cloudy" } },
    });

    const res = await get("/weather?ids=london,tokyo");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; tzId: string }[];
    expect(body.map((r) => r.id)).toEqual(["london", "tokyo"]);
    expect(body[0]).toEqual({
      id: "london",
      tempC: 14,
      windKph: 8,
      condition: "Cloudy",
      tzId: "Europe/London",
    });
  });

  it("refuses too many places and unknown ids", async () => {
    process.env["WEATHERAPI_KEY"] = "k";
    const fetchSpy = mockFetchJson({});
    expect((await get("/weather?ids=")).status).toBe(400);
    expect((await get("/weather?ids=london,tokyo,oslo,dubai,cairo,lima")).status).toBe(400);
    expect((await get("/weather?ids=london,atlantis")).status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("GET /attendance", () => {
  it("passes the full summary through, renaming totalMembers", async () => {
    process.env["TRAVA_ATTENDANCE_API_URL"] = "https://example.test/summary";
    process.env["TRAVA_ATTENDANCE_WORKSPACE_ID"] = "ws";
    mockFetchJson({
      success: true,
      data: { date: "2026-10-16", totalMembers: 20, present: 12, late: 3, absent: 4, halfDay: 0, onLeave: 1 },
    });

    const res = await get("/attendance");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      date: "2026-10-16",
      total: 20,
      present: 12,
      late: 3,
      absent: 4,
      halfDay: 0,
      onLeave: 1,
    });
  });
});

describe("GET /video", () => {
  it("only accepts allowlisted object names", async () => {
    expect(isStudioVideoName("art_1_grayscale.mp4")).toBe(true);
    expect(isStudioVideoName("../secrets.csv")).toBe(false);
    expect(isStudioVideoName("constructor")).toBe(false);
    expect((await get("/video?name=secrets.csv")).status).toBe(404);
  });

  it("redirects to the public base when one is configured", async () => {
    process.env["DATA_ART_VIDEO_BASE_URL"] = "https://videos.example.test/";
    const res = await get("/video?name=art_2_velocity.mp4");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://videos.example.test/art_2_velocity.mp4");
  });

  it("presigns into the configured bucket and prefix otherwise", async () => {
    delete process.env["DATA_ART_VIDEO_BASE_URL"];
    Object.assign(process.env, {
      FLIGHT_R2_ACCESS_KEY_ID: "id",
      FLIGHT_R2_SECRET_ACCESS_KEY: "secret",
      FLIGHT_R2_BUCKET: "flight-bucket",
      FLIGHT_R2_ENDPOINT: "https://account.r2.cloudflarestorage.com/flight-bucket",
      DATA_ART_R2_BUCKET: "data-art",
      DATA_ART_R2_PREFIX: "studio/",
    });
    const res = await get("/video?name=art_1_grayscale.mp4");
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.host).toBe("account.r2.cloudflarestorage.com");
    expect(location.pathname).toBe("/data-art/studio/art_1_grayscale.mp4");
    expect(location.searchParams.has("X-Amz-Signature")).toBe(true);
  });

  it("answers 503 with no storage configured", async () => {
    for (const k of ["DATA_ART_VIDEO_BASE_URL", "FLIGHT_R2_ACCESS_KEY_ID", "FLIGHT_R2_SECRET_ACCESS_KEY", "FLIGHT_R2_BUCKET", "FLIGHT_R2_ENDPOINT"]) {
      delete process.env[k];
    }
    expect((await get("/video?name=art_1_grayscale.mp4")).status).toBe(503);
  });
});
