/** The artworks a clock can show behind its bands. */
export const ARTS = [
  { id: "map", name: "World Map" },
  { id: "fabric", name: "Fabric" },
];
export const ARTS_BY_ID = new Map(ARTS.map((a) => [a.id, a]));
export const DEFAULT_ART = "map";
