import { describe, it, expect } from "vitest";
import { readDataArtView } from "../src/templates/drava-mosaic/content";

// The studio's view crosses the WebSocket and a postMessage hop, so whatever
// arrives is untrusted: it has to come out as a well-formed view or nothing.

describe("readDataArtView", () => {
  it("passes a well-formed view through", () => {
    expect(readDataArtView({ data: "dataCard2", art: "artCard1", open: true })).toEqual({
      data: "dataCard2",
      art: "artCard1",
      open: true,
      clock: null,
    });
  });

  it("keeps a running World Clock so Show Clock reaches the other screens", () => {
    expect(
      readDataArtView({ data: "d", art: "a", open: true, clock: { places: ["london", "tokyo", 3], art: "fabric", style: "digital" } })?.clock,
    ).toEqual({ places: ["london", "tokyo"], art: "fabric", style: "digital", running: true });
    expect(readDataArtView({ data: "d", art: "a", open: true, clock: { places: [] } })?.clock).toBeNull();
    expect(readDataArtView({ data: "d", art: "a", open: true, clock: "x" })?.clock).toBeNull();
  });

  it("keeps the World Clock city picker's choices, even with no city picked yet", () => {
    expect(
      readDataArtView({ data: "d", art: "a", open: true, clock: { places: ["paris"], art: "map", style: "analog", running: false } })?.clock,
    ).toEqual({ places: ["paris"], art: "map", style: "analog", running: false });
    expect(
      readDataArtView({ data: "d", art: "a", open: true, clock: { places: [], art: "fabric", style: null, running: false } })?.clock,
    ).toEqual({ places: [], art: "fabric", style: null, running: false });
  });

  it("treats missing or wrongly-typed fields as nothing picked / not open", () => {
    expect(readDataArtView({ data: 3, art: null, open: "yes" })).toEqual({
      data: null,
      art: null,
      open: false,
      clock: null,
    });
  });

  it("rejects non-objects", () => {
    expect(readDataArtView(undefined)).toBeNull();
    expect(readDataArtView(null)).toBeNull();
    expect(readDataArtView("dataCard1")).toBeNull();
  });

  it("drops absurdly long ids", () => {
    expect(readDataArtView({ data: "x".repeat(500), art: "artCard1", open: false })?.data).toBeNull();
  });
});
