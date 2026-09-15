// The Data Art template's two axes: the DATA source driving the garden, and the
// ART render it is mapped onto ("pick the data to map, and the art to map it
// onto"). Historically each scene was welded to one clip; these ids let the CMS
// choose either side independently.
//
// This lives in @platform/types rather than @platform/ui because the API needs
// it too — apps/api is a Node process and must never import the UI package,
// which pulls React and three.js. The R2 object keys stay in
// apps/api/src/services/flight-video.ts: that file is the security boundary and
// this one ships to the browser.

/** Scene ids the garden can run — mirrors the SCENES keys in flight-garden.js. */
export const DATA_SOURCES = ["flight", "weather", "attendance"] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export interface ArtEntry {
  /** Short id, matched against VIDEO_KEYS in the API's flight-video service. */
  id: string;
  label: string;
  blurb: string;
  thumbnail: string;
  /**
   * The render's own dominant hue, in turns (0 = the red the thermal anchors
   * were authored against). The weather scene tints by ROTATING the clip's
   * existing colour, so mapping WEATHER onto a green or purple render would put
   * every temperature band on the wrong colour unless the anchors are rebased
   * by this. Omitted = 0 = no rebase.
   */
  nativeHueTurns?: number;
}

export const ART_CATALOG: ArtEntry[] = [
  {
    id: "flight-garden",
    label: "ART 1",
    blurb: "Original Flight Garden 4K render",
    thumbnail: "/media/flight-garden/art/art-1.jpg",
    nativeHueTurns: 0,
  },
  {
    id: "weather-warm",
    label: "ART 2",
    blurb: "Thermal warm render",
    thumbnail: "/media/flight-garden/art/weather-warm.jpg",
    nativeHueTurns: 0,
  },
  {
    id: "art-3",
    label: "ART 3",
    blurb: "A new garden render",
    thumbnail: "/media/flight-garden/art/art-3.jpg",
  },
  {
    id: "art-4",
    label: "ART 4",
    blurb: "A new garden render",
    thumbnail: "/media/flight-garden/art/art-4.jpg",
  },
  {
    id: "art-5",
    label: "ART 5",
    blurb: "A new garden render",
    thumbnail: "/media/flight-garden/art/art-5.jpg",
  },
  {
    id: "art-6",
    label: "ART 6",
    blurb: "A new garden render",
    thumbnail: "/media/flight-garden/art/art-6.jpg",
  },
];

export const DEFAULT_ART_ID = "flight-garden";

/** Catalog lookup by id, or undefined for an id that is not offered. */
export function findArt(id: string | undefined): ArtEntry | undefined {
  return ART_CATALOG.find((a) => a.id === id);
}
