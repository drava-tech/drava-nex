// The Drava World template — the standalone Drava World app (the virtual
// Experience Centre: a walkable 3D tour of every zone, hosted by TRAVIS),
// built from packages/drava-world and served by the CMS as static pages under
// /drava-world/.
//
// There is deliberately nothing to author: the template shows Drava World
// exactly as the standalone app does, and everything happens inside it.

/** Where apps/cms serves the built app (see apps/cms/scripts/sync-drava-world.mjs). */
export const DRAVA_WORLD_BASE_URL = "/drava-world/";

/** The app's entry page — the Welcome Zone, where the standalone app opens. */
export const DRAVA_WORLD_URL = `${DRAVA_WORLD_BASE_URL}index.html`;
