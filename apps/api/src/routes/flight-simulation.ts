// Runtime data for the Flight Garden simulation template.
//
// Both reads are PUBLIC: display screens run unauthenticated (same as
// GET /api/products/:id/display), and this is authored reference data plus a
// procedurally generated board — nothing tenant-specific or sensitive.
//
// The renderer treats this API as an enhancement, not a dependency: on any
// failure it falls back to local generation, so an unattended screen never
// blanks. Keep that contract in mind before making anything here fatal.

import { Hono } from "hono";
import { flightSimulationQuerySchema, formatZodError } from "@platform/types";
import { ok, fail } from "../lib/response.js";
import { getCatalog } from "../services/flight-catalog.js";
import { currentSeed, generateRoster } from "../services/flight-generator.js";
import { resolveLocation } from "../services/flight-locations.js";
import { presignR2Get, readR2Config, resolveVideoKey, artExists } from "../services/flight-video.js";
import { ART_CATALOG, type ArtEntry } from "@platform/types";

export const flightSimulationRouter = new Hono();

// GET /api/flight-simulation/airports — the selectable airport + carrier catalog.
flightSimulationRouter.get("/airports", (c) => {
  return ok(c, getCatalog());
});

// GET /api/flight-simulation/arts — output art catalog with availability flags.
flightSimulationRouter.get("/arts", async (c) => {
  // `available` is a real bucket probe, not allowlist membership: ids for
  // renders nobody has uploaded yet are reserved below in VIDEO_KEYS, and the
  // CMS greys those out rather than letting an operator push a clip that would
  // arrive on the wall as the fallback render.
  const arts = await Promise.all(
    ART_CATALOG.map(async (art: ArtEntry) => ({
      ...art,
      available: await artExists(art.id),
    }))
  );
  return ok(c, arts);
});

// GET /api/flight-simulation/flights?airport=BLR&limit=24&seed=123
flightSimulationRouter.get("/flights", (c) => {
  const parsed = flightSimulationQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return fail(c, "VALIDATION", "Invalid query.", 422, formatZodError(parsed.error));
  }

  const { airport, limit } = parsed.data;
  const seed = parsed.data.seed ?? currentSeed();

  const roster = generateRoster({ airport, limit, seed });
  if (!roster) {
    return fail(c, "UNKNOWN_AIRPORT", `No airport in the catalog matches "${airport}".`, 404);
  }

  return ok(c, roster);
});

/* ───────────────────────────────────────────────────────────────────────────
   Scene feeds
   ---------------------------------------------------------------------------
   The template is a player for visualizations, not one visualization: besides
   the flight board above, its scenes draw on live weather and live attendance.
   Both are third-party APIs behind a key, so the browser never calls them
   directly — these two routes proxy them so the keys stay server-side.

   Every one of them is best-effort by the same contract as /flights: the
   engine keeps rendering on a failure, so an unreachable provider degrades the
   scene rather than blanking the screen.
   ────────────────────────────────────────────────────────────────────────── */

// GET /api/flight-simulation/wind?location=bengaluru
// One WeatherAPI call returns wind *and* temperature: kph drives the garden
// video's playback rate in every scene, tempC additionally tints the weather
// scene's render, so the second scene costs no extra rate limit.
flightSimulationRouter.get("/wind", async (c) => {
  const key = process.env["WEATHERAPI_KEY"];
  if (!key) {
    return fail(c, "NOT_CONFIGURED", "WEATHERAPI_KEY is not set.", 503);
  }

  // `location` is an id from the allowlist, never a raw query — see
  // flight-locations.ts. An unknown id is refused rather than forwarded.
  const location = resolveLocation(c.req.query("location"));
  if (!location) {
    return fail(c, "UNKNOWN_LOCATION", `No allowlisted location matches "${c.req.query("location")}".`, 404);
  }

  try {
    const url =
      `https://api.weatherapi.com/v1/current.json` +
      `?key=${encodeURIComponent(key)}&q=${encodeURIComponent(location.query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`weatherapi → HTTP ${res.status}`);

    const data = (await res.json()) as {
      current?: { wind_kph?: number; temp_c?: number; condition?: { text?: string } };
    };
    if (typeof data.current?.wind_kph !== "number") {
      throw new Error("weatherapi returned no wind_kph");
    }

    c.header("Cache-Control", "no-store");
    return ok(c, {
      kph: data.current.wind_kph,
      tempC: data.current.temp_c ?? null,
      condition: data.current.condition?.text ?? null,
    });
  } catch (err) {
    return fail(c, "UPSTREAM_FAILED", `Weather provider unavailable: ${String(err)}`, 502);
  }
});

// GET /api/flight-simulation/attendance
// Present/absent/late headcounts from trava-app. The workspace id is not a
// secret, but it is kept server-side rather than accepted as a query param that
// callers could point at someone else's workspace.
flightSimulationRouter.get("/attendance", async (c) => {
  const base = process.env["TRAVA_ATTENDANCE_API_URL"];
  const workspaceId = process.env["TRAVA_ATTENDANCE_WORKSPACE_ID"];
  if (!base || !workspaceId) {
    return fail(
      c,
      "NOT_CONFIGURED",
      "TRAVA_ATTENDANCE_API_URL / TRAVA_ATTENDANCE_WORKSPACE_ID are not set.",
      503
    );
  }

  const key = process.env["TRAVA_ATTENDANCE_API_KEY"];

  try {
    const url = `${base}?workspaceId=${encodeURIComponent(workspaceId)}`;
    const res = await fetch(url, {
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    });

    const body = (await res.json()) as {
      success?: boolean;
      error?: string;
      data?: { present?: number; absent?: number; late?: number };
    };
    if (!res.ok || !body.success || !body.data) {
      throw new Error(body.error ?? `trava-app → HTTP ${res.status}`);
    }

    const { present, absent, late } = body.data;
    if (typeof present !== "number" || typeof absent !== "number" || typeof late !== "number") {
      throw new Error("trava-app returned incomplete attendance counts");
    }

    c.header("Cache-Control", "no-store");
    // halfDay/onLeave count toward none of present, absent or late, so they are
    // deliberately left out of this reading rather than folded into one of them.
    return ok(c, { present, absent, late });
  } catch (err) {
    return fail(c, "UPSTREAM_FAILED", `Attendance provider unavailable: ${String(err)}`, 502);
  }
});

// GET /api/flight-simulation/garden-video?id=flight-garden
//
// 302s to a short-lived presigned R2 URL for the scene's 4K render. Unlike the
// JSON routes above this deliberately does NOT use the response envelope — the
// browser follows it with a plain <video src>, and the redirect target is what
// carries R2's CORS headers and Range support, which is what lets a
// cross-origin video both stream and seek.
flightSimulationRouter.get("/garden-video", (c) => {
  // `id` selects which render to stream. Only allowlisted ids resolve to a key;
  // anything else is refused rather than signed. See flight-video.ts.
  const requested = c.req.query("id");
  const key = resolveVideoKey(requested);
  if (!key) {
    return fail(c, "UNKNOWN_VIDEO", `No allowlisted render matches "${requested}".`, 404);
  }

  const config = readR2Config();
  if (!config) {
    // Not an error the display should retry against: without a bucket there is
    // no video at all, and the engine falls back to the committed still image.
    return fail(c, "NOT_CONFIGURED", "Flight Garden R2 storage is not configured.", 503);
  }

  try {
    const url = presignR2Get(config, key, 6 * 60 * 60);
    // Matches the presign lifetime's own cache window, so a cached video never
    // outlives the URL that fetched it.
    c.header("Cache-Control", "private, max-age=3600");
    return c.redirect(url, 302);
  } catch (err) {
    return fail(c, "SIGNING_FAILED", `Could not sign the render URL: ${String(err)}`, 500);
  }
});
