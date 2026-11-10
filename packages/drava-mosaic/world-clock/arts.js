import { startFabricArt } from "./fabricArt.js";
import { startParticleArt } from "./particleArt.js";
import { startPlaneArt } from "./planeArt.js";

/**
 * The artworks a clock can show behind its bands. All but the map are started
 * with `start(canvas, getBands)`; the map needs its own places, so clock.js
 * starts it itself and the landing page stands in a flat preview.
 */
export const ARTS = [
  { id: "map", name: "World Map" },
  { id: "fabric", name: "Fabric", start: startFabricArt },
  { id: "particles", name: "Particles", noWind: true, start: startParticleArt },
  { id: "plane", name: "Aeroplane", bandLines: true, start: startPlaneArt },
];
export const ARTS_BY_ID = new Map(ARTS.map((a) => [a.id, a]));
export const DEFAULT_ART = "map";
