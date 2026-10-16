// Runtime data for the Data Art Studio template.
//
// The studio is the standalone Data Art Studio app (packages/data-art-studio),
// served by the CMS as static pages under /data-art-studio/. Standalone, it ran
// on Vercel with four serverless functions beside it; these routes replace them
// so the pages work on the LAN with the same keys the Flight Simulation uses.
//
// Deliberately NOT the { success, data } envelope the rest of this API uses:
// the studio's client code parses the original functions' bare JSON (and reads
// `error` off a failure), and keeping that contract means the ported pages need
// no changes beyond their URLs. Like the flight feeds, every route is public
// (displays run unauthenticated) and best-effort — the pages keep rendering on
// a failure.

import { Hono, type Context } from "hono";
import { resolveLocation } from "../services/flight-locations.js";
import { presignR2Get, readR2Config } from "../services/flight-video.js";
import { MAX_CLOCK_PLACES, resolveClockLocation } from "../services/data-art-locations.js";

export const dataArtStudioRouter = new Hono();

function sendJson(c: Context, status: 200 | 400 | 404 | 502 | 503, body: unknown) {
  c.header("Cache-Control", "no-store");
  return c.json(body, status);
}

interface WeatherApiCurrent {
  location?: { tz_id?: string };
  current?: { wind_kph?: number; temp_c?: number; condition?: { text?: string } };
}

async function fetchCurrentWeather(key: string, query: string): Promise<WeatherApiCurrent> {
  const url =
    `https://api.weatherapi.com/v1/current.json` +
    `?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url);
  // The request URL carries the key, so only the status is passed on.
  if (!res.ok) throw new Error(`WeatherAPI → HTTP ${res.status}`);
  return (await res.json()) as WeatherApiCurrent;
}

// GET /api/data-art-studio/wind?location=bengaluru → { kph, tempC, condition }
// The studio's Weather output and its Flight Garden's weather scene. Same
// location allowlist as /api/flight-simulation/wind — the ids are shared.
dataArtStudioRouter.get("/wind", async (c) => {
  const key = process.env["WEATHERAPI_KEY"];
  if (!key) return sendJson(c, 503, { error: "WEATHERAPI_KEY not configured" });

  const location = resolveLocation(c.req.query("location"));
  if (!location) {
    return sendJson(c, 400, { error: `unknown location: ${c.req.query("location")}` });
  }

  try {
    const data = await fetchCurrentWeather(key, location.query);
    return sendJson(c, 200, {
      kph: data.current?.wind_kph ?? null,
      tempC: data.current?.temp_c ?? null,
      condition: data.current?.condition?.text ?? null,
    });
  } catch (err) {
    return sendJson(c, 502, { error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/data-art-studio/weather?ids=newyork,london
//   → [{ id, tempC, windKph, condition, tzId }]
// The World Clock's weather bands.
dataArtStudioRouter.get("/weather", async (c) => {
  const key = process.env["WEATHERAPI_KEY"];
  if (!key) return sendJson(c, 503, { error: "WEATHERAPI_KEY not configured" });

  const ids = (c.req.query("ids") ?? "").split(",").filter(Boolean);
  if (ids.length === 0 || ids.length > MAX_CLOCK_PLACES) {
    return sendJson(c, 400, { error: `ids must list 1–${MAX_CLOCK_PLACES} places` });
  }
  const unknown = ids.find((id) => !resolveClockLocation(id));
  if (unknown) return sendJson(c, 400, { error: `unknown location: ${unknown}` });

  try {
    const readings = await Promise.all(
      ids.map(async (id) => {
        const data = await fetchCurrentWeather(key, resolveClockLocation(id)!);
        return {
          id,
          tempC: data.current?.temp_c ?? null,
          windKph: data.current?.wind_kph ?? null,
          condition: data.current?.condition?.text ?? null,
          tzId: data.location?.tz_id ?? null,
        };
      })
    );
    return sendJson(c, 200, readings);
  } catch (err) {
    return sendJson(c, 502, { error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/data-art-studio/attendance
//   → { date, total, present, late, absent, halfDay, onLeave }
// Today's headcounts for the studio's Attendance output. Same upstream and
// env vars as /api/flight-simulation/attendance, but the studio wants the full
// summary (total, half-day, on-leave), not just the three zone counts.
dataArtStudioRouter.get("/attendance", async (c) => {
  const base = process.env["TRAVA_ATTENDANCE_API_URL"];
  const workspaceId = process.env["TRAVA_ATTENDANCE_WORKSPACE_ID"];
  if (!base || !workspaceId) {
    return sendJson(c, 503, {
      error: "TRAVA_ATTENDANCE_API_URL / TRAVA_ATTENDANCE_WORKSPACE_ID not configured",
    });
  }
  const key = process.env["TRAVA_ATTENDANCE_API_KEY"];

  try {
    const res = await fetch(`${base}?workspaceId=${encodeURIComponent(workspaceId)}`, {
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    });
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      data?: {
        date?: string;
        totalMembers?: number;
        present?: number;
        late?: number;
        absent?: number;
        halfDay?: number;
        onLeave?: number;
      };
    };
    if (!res.ok || !body.success || !body.data) {
      throw new Error(body.error ?? `Tusker → HTTP ${res.status}`);
    }

    // Every member is counted in exactly one status, so `present` means on
    // time and excludes `late`.
    const { date, totalMembers, present, late, absent, halfDay, onLeave } = body.data;
    return sendJson(c, 200, { date, total: totalMembers, present, late, absent, halfDay, onLeave });
  } catch (err) {
    return sendJson(c, 502, { error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * Every video object the studio may stream. An allowlist for the same reason
 * as VIDEO_KEYS in flight-video.ts: the route signs what it is handed, so an
 * unchecked name would mint a signed link to any object in the bucket.
 *
 * The names are the studio's own (its art cards' data-main/data-velo and
 * VIDEO_PATHS in flight-garden/main.js).
 */
const VIDEO_NAMES = new Set([
  "4k_render_final_001.mp4",
  "art_1_grayscale.mp4",
  "art_1_velocity.mp4",
  "art_2_grayscale.mp4",
  "art_2_velocity.mp4",
  "art_3_grayscale.mp4",
  "art_3_velocity.mp4",
  "art_4_grayscale.mp4",
  "art_4_velocity.mp4",
]);

export function isStudioVideoName(name: string | undefined): name is string {
  return typeof name === "string" && VIDEO_NAMES.has(name);
}

// GET /api/data-art-studio/video?name=art_1_grayscale.mp4
//
// 302s to the clip. With DATA_ART_VIDEO_BASE_URL set (a public bucket URL or
// custom domain) it redirects there; otherwise it presigns a GET against the
// R2 credentials the Flight Simulation already uses (FLIGHT_R2_*), optionally
// in another bucket (DATA_ART_R2_BUCKET) and under a key prefix
// (DATA_ART_R2_PREFIX). Either way the bucket's CORS must allow the CMS origin:
// the studio uploads frames to WebGL, which a cross-origin video without CORS
// headers would taint.
dataArtStudioRouter.get("/video", (c) => {
  const name = c.req.query("name");
  if (!isStudioVideoName(name)) {
    return sendJson(c, 404, { error: `unknown video: ${name}` });
  }

  const publicBase = process.env["DATA_ART_VIDEO_BASE_URL"];
  if (publicBase) {
    c.header("Cache-Control", "public, max-age=3600");
    return c.redirect(`${publicBase.replace(/\/$/, "")}/${name}`, 302);
  }

  const config = readR2Config();
  if (!config) return sendJson(c, 503, { error: "Data Art Studio video storage is not configured" });

  try {
    const bucket = process.env["DATA_ART_R2_BUCKET"] || config.bucket;
    const prefix = process.env["DATA_ART_R2_PREFIX"] ?? "";
    const url = presignR2Get({ ...config, bucket }, `${prefix}${name}`, 6 * 60 * 60);
    // Within the presign lifetime, so a cached redirect never outlives its URL.
    c.header("Cache-Control", "private, max-age=3600");
    return c.redirect(url, 302);
  } catch (err) {
    return sendJson(c, 502, { error: `Could not sign the video URL: ${String(err)}` });
  }
});
