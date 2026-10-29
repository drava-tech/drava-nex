import { describe, it, expect } from "vitest";
import { readDataArtView } from "../src/templates/data-art-studio/content";

// The studio's view crosses the WebSocket and a postMessage hop, so whatever
// arrives is untrusted: it has to come out as a well-formed view or nothing.

describe("readDataArtView", () => {
  it("passes a well-formed view through", () => {
    expect(readDataArtView({ data: "dataCard2", art: "artCard1", open: true })).toEqual({
      data: "dataCard2",
      art: "artCard1",
      open: true,
    });
  });

  it("treats missing or wrongly-typed fields as nothing picked / not open", () => {
    expect(readDataArtView({ data: 3, art: null, open: "yes" })).toEqual({
      data: null,
      art: null,
      open: false,
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
