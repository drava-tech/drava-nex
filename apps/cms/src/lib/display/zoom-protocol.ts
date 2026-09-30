/**
 * Zoom transport for the CMS-hosted document viewers (PDF, slides, Word), sent
 * over the existing screen command channel. Shaped exactly like
 * playback-protocol.ts, for the same reasons:
 *
 *  - The CMS sends only DELTAS (ZOOM_IN, ZOOM_OUT). It cannot know a viewer's
 *    current factor — SCREEN_COMMAND fans out, it doesn't reply — so it must
 *    not try to assert one.
 *  - The authoritative viewer answers with its ABSOLUTE view state, which
 *    already exists per viewer (SET_PDF_VIEW, SET_SLIDES_VIEW, SET_WORD_VIEW)
 *    and now carries a `zoom` field. Absolute means a duplicate or late echo
 *    is a harmless no-op, where a replayed delta would zoom twice.
 *  - The SET_ prefix is load-bearing: the gateway caches any SET_* per screen
 *    AND per content and replays it when that content is pushed again
 *    (viewStateCache in apps/api/src/ws/gateway.ts). That is what makes a
 *    document come back at the zoom it was left at, exactly as it already
 *    comes back on the page it was left at.
 *
 * No gateway or @platform/types change is needed — `command` is an untyped
 * string there and there is no allowlist. The one place a new command MUST be
 * registered is FRAME_FORWARDED_COMMANDS in ./frame-bridge.ts, or it never
 * crosses into the viewer's iframe.
 */

/** CMS → viewer. One step in. */
export const ZOOM_IN = "ZOOM_IN";
/** CMS → viewer. One step out. */
export const ZOOM_OUT = "ZOOM_OUT";

/** Window events the display page republishes these as, for framed viewers. */
export const ZOOM_IN_EVENT = "zoom-in";
export const ZOOM_OUT_EVENT = "zoom-out";

/**
 * Ten percentage points per tap, ADDED rather than multiplied — so the readout
 * moves 100, 90, 80 … exactly as the buttons imply. A multiplier would give
 * uneven, unpredictable stops (100, 80, 64, 51 …) that never land on a round
 * number.
 */
export const ZOOM_STEP = 0.1;

/**
 * Furthest out. Well below fit-to-width, so a long document can be pulled back
 * to a thumbnail overview rather than only ever being read a page at a time.
 *
 * NOT the value an unzoomed document opens at — see ZOOM_DEFAULT.
 */
export const ZOOM_MIN = 0.1;

/**
 * Past this the picture stops improving. PdfViewer renders at
 * (renderWidth / pageWidth) * dpr and caps the canvas at MAX_CANVAS_PIXELS
 * (2**23), so on a 4K panel a factor much above this exhausts the allocation
 * and pages get blurrier, not sharper — a zoom control that visibly degrades
 * the thing it is meant to magnify.
 */
export const ZOOM_MAX = 2.5;

/**
 * Fit-to-width: what a document opens at when nothing has been stored for it.
 *
 * Deliberately separate from ZOOM_MIN, which used to serve as both. The moment
 * the floor dropped below fit-to-width, a shared constant would have meant every
 * document with no remembered zoom opening at 10% — a total regression on the
 * most common path, and one nothing would have caught at compile time. The floor
 * and the default are different ideas and now have different names.
 */
export const ZOOM_DEFAULT = 1;

/**
 * Clamp to the usable range, tolerating a missing or corrupt stored value.
 * A value that isn't a usable number falls back to fit-to-width, NOT to the
 * floor.
 */
export function clampZoom(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return ZOOM_DEFAULT;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/**
 * Apply one step, clamped.
 *
 * Rounded to one decimal because repeated float addition drifts — nine steps
 * down from 1 lands on 0.09999999999999998 without it, which then displays as
 * "10%" but compares unequal to ZOOM_MIN, so the button never reports itself as
 * having hit the limit.
 */
export function stepZoom(current: number | undefined, direction: "in" | "out"): number {
  const base = clampZoom(current);
  const next = direction === "in" ? base + ZOOM_STEP : base - ZOOM_STEP;
  return clampZoom(Math.round(next * 10) / 10);
}
