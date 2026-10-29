// The Data Art Studio template — the standalone Data Art Studio app
// (VelocityMap studio, Flight Garden, World Clock), built from
// packages/data-art-studio and served by the CMS as static pages under
// /data-art-studio/.
//
// There is deliberately nothing to author: the template shows the studio
// exactly as the standalone app does, and everything is chosen inside it. Live
// data (weather, attendance) and the video renders come from
// /api/data-art-studio/* at render time.

/** Where apps/cms serves the built studio (see apps/cms/scripts/sync-data-art-studio.mjs). */
export const DATA_ART_STUDIO_BASE_URL = "/data-art-studio/";

/** The studio's entry page — the same page the standalone app opens on. */
export const DATA_ART_STUDIO_URL = `${DATA_ART_STUDIO_BASE_URL}velocitymapping.html`;

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
  return { data: id(v["data"]), art: id(v["art"]), open: v["open"] === true };
}
