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
