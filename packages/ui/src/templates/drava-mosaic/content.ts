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
