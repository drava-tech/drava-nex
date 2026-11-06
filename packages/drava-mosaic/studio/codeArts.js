import { createTideArt } from "./tideArt.js";

/**
 * The studio's arts that are made in code rather than played from a video,
 * by the id an art card names in data-code-art. Each is made in a WebGL 2
 * context the studio gives it, and draws its render and velocity pass into
 * one texture there (see tideArt.js).
 *
 * The studio's script is a classic one, which runs before this module, so
 * the arts are handed to it on window, with an event once they're there.
 */
window.dravaCodeArts = {
  tide: createTideArt,
};
window.dispatchEvent(new Event("drava-code-arts-ready"));
