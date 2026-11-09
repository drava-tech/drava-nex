// The Drava Mosaic template — the standalone Drava Mosaic app
// (VelocityMap studio, Flight Garden, World Clock), built from
// packages/drava-mosaic and served by the CMS as static pages under
// /drava-mosaic/.
//
// There is deliberately nothing to author: the template shows the studio
// exactly as the standalone app does, and everything is chosen inside it. Live
// data (weather, attendance) and the video renders come from
// /api/drava-mosaic/* at render time.

/** Where apps/cms serves the built studio (see apps/cms/scripts/sync-drava-mosaic.mjs). */
export const DRAVA_MOSAIC_BASE_URL = "/drava-mosaic/";

/** The studio's entry page — the same page the standalone app opens on. */
export const DRAVA_MOSAIC_URL = `${DRAVA_MOSAIC_BASE_URL}velocitymapping.html`;

// ── Live sync between a control surface and the wall ────────────────────────
// The studio is an iframe, so its choices reach other clients of the screen
// through the same bus the other templates use: the renderer publishes a
// `screen-control` event, LiveScreenPlayer relays it over the gateway (any
// SET_* command is relayed to every client, echoed back to the sender, and
// remembered for late joiners), and the inbound command comes back as
// DATA_ART_VIEW_EVENT.

/** Relayed command carrying the studio's top-level choice. */
export const DATA_ART_VIEW_COMMAND = "SET_DATA_ART_VIEW";
/** The window event LiveScreenPlayer turns an inbound DATA_ART_VIEW_COMMAND into. */
export const DATA_ART_VIEW_EVENT = "data-art-set-view";

/**
 * What the studio's landing page has chosen: a data source card, an art card,
 * and whether Generate has been pressed (an artwork is open). Ids are the
 * studio's own element ids (`dataCard2`, `artCard1`, ...); null = nothing
 * picked yet. Deeper in-scene controls are deliberately not part of this.
 */
export interface DataArtView {
  data: string | null;
  art: string | null;
  open: boolean;
  /** World Clock only: the running clock ("Show Clock" pressed); null = city picker / other art. */
  clock: DataArtClock | null;
}

/** The World Clock a screen is showing: place ids, artwork id and clock style id. */
export interface DataArtClock {
  places: string[];
  art: string | null;
  style: string | null;
}

/** Studio -> parent: the operator changed something. */
export const DATA_ART_STATE_MESSAGE = "data-art-state";
/** Parent -> studio: apply this view. */
export const DATA_ART_APPLY_MESSAGE = "data-art-apply";
/** Studio -> parent: the page is up and can take a view. */
export const DATA_ART_READY_MESSAGE = "data-art-ready";

/** Coerces anything off the wire into a view, or null if it isn't one. */
export function readDataArtView(value: unknown): DataArtView | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const id = (x: unknown) => (typeof x === "string" && x.length <= 64 ? x : null);
  return { data: id(v["data"]), art: id(v["art"]), open: v["open"] === true, clock: readClock(v["clock"]) };
}

function readClock(value: unknown): DataArtClock | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (!Array.isArray(c["places"])) return null;
  const id = (x: unknown) => (typeof x === "string" && x.length <= 64 ? x : null);
  const places = c["places"].filter((p): p is string => typeof p === "string" && p.length <= 64).slice(0, 5);
  if (places.length === 0) return null;
  return { places, art: id(c["art"]), style: id(c["style"]) };
}
