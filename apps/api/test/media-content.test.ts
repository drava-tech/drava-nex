import { describe, it, expect } from "vitest";
import {
  classifyLink,
  isMediaType,
  isLinkMediaType,
  mediaEmbedUrl,
  mediaAssetToWsContent,
  SLIDES_VIEWER_PATH,
} from "@platform/types";

describe("presentation media type", () => {
  it("is a recognised media type, and not a link kind", () => {
    expect(isMediaType("presentation")).toBe(true);
    // Uploaded from a file, so the UI must still offer Download for it.
    expect(isLinkMediaType("presentation")).toBe(false);
  });

  it("classifies a direct .pptx link as a presentation", () => {
    const classified = classifyLink("https://example.com/decks/q3-review.pptx");
    expect(classified).toEqual({
      type: "presentation",
      url: "https://example.com/decks/q3-review.pptx",
      name: "q3-review.pptx",
    });
  });

  it("still routes Google Slides through the Drive embed, not our viewer", () => {
    const classified = classifyLink("https://docs.google.com/presentation/d/abc123/edit");
    expect(classified?.type).toBe("drive");
    expect(classified?.name).toBe("Google Slides");
  });

  it("embeds through the local viewer, adding kiosk only for screens", () => {
    const url = "/media/deck.pptx";
    const encoded = encodeURIComponent(url);

    expect(mediaEmbedUrl("presentation", url)).toBe(`${SLIDES_VIEWER_PATH}?src=${encoded}`);
    expect(mediaEmbedUrl("presentation", url, { kiosk: true })).toBe(
      `${SLIDES_VIEWER_PATH}?src=${encoded}&kiosk=1`
    );
  });

  it("reaches a screen as html pointed at the kiosk viewer", () => {
    const content = mediaAssetToWsContent({
      id: "m1",
      type: "presentation",
      url: "/media/deck.pptx",
      name: "Deck",
    });

    expect(content.type).toBe("html");
    expect(content.source).toContain(SLIDES_VIEWER_PATH);
    expect(content.source).toContain("kiosk=1");
  });
});
