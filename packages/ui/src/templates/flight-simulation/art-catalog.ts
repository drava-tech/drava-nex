// The art catalog lives in @platform/types so the API can read it without
// importing this package (which pulls React and three.js into a Node process).
// Re-exported here so the template's own modules can keep importing it locally.
export {
  DATA_SOURCES,
  ART_CATALOG,
  DEFAULT_ART_ID,
  findArt,
  type DataSource,
  type ArtEntry,
} from "@platform/types";
