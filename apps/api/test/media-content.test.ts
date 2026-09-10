import { describe, it, expect } from "vitest";
import {
  classifyLink,
  isMediaType,
  isLinkMediaType,
  mediaEmbedUrl,
  mediaAssetToWsContent,
  normalizeUrl,
  PDF_VIEWER_PATH,
  SLIDES_VIEWER_PATH,
  WORD_VIEWER_PATH,
} from "@platform/types";

describe("document media type", () => {
  it("is a recognised media type, and not a link kind", () => {
    expect(isMediaType("document")).toBe(true);
    // Uploaded from a file, so the UI must still offer Download for it.
    expect(isLinkMediaType("document")).toBe(false);
  });

  it("embeds through our own PDF.js viewer — no kiosk variant, since the viewer owns its chrome", () => {
    const url = "/media/deck.pdf";
    const encoded = encodeURIComponent(url);

    expect(mediaEmbedUrl("document", url)).toBe(`${PDF_VIEWER_PATH}?src=${encoded}`);
    expect(mediaEmbedUrl("document", url, { kiosk: true })).toBe(`${PDF_VIEWER_PATH}?src=${encoded}`);
  });

  it("no longer hands the browser's built-in viewer its Open Parameters", () => {
    // Guards the migration off Chromium's built-in viewer: those parameters
    // only ever meant anything to it, and it can neither be driven remotely
    // nor resumed where it was left.
    const embedded = mediaEmbedUrl("document", "/media/deck.pdf", { kiosk: true });
    expect(embedded).not.toContain("#toolbar=0");
    expect(embedded).not.toContain("view=FitH");
  });

  it("still ends in .pdf, which is why the renderer must not sniff PDFs by URL shape", () => {
    // The src is percent-encoded into the query, so a naive /\.pdf$/ test
    // matches our viewer route too. HtmlRenderer used to do exactly that and
    // would have stripped this frame's sandbox; it now matches on the viewer
    // path instead. Encoded here so the trap can't be reintroduced silently.
    const embedded = mediaEmbedUrl("document", "/media/deck.pdf", { kiosk: true });
    expect(/\.pdf(#|\?|$)/i.test(embedded)).toBe(true);
    expect(embedded.startsWith(PDF_VIEWER_PATH)).toBe(true);
  });

  it("reaches a screen as an embedded page", () => {
    const content = mediaAssetToWsContent({
      id: "asset-pdf",
      type: "document",
      url: "/media/deck.pdf",
      name: "deck.pdf",
    });
    expect(content.type).toBe("html");
    expect(content.source).toContain(PDF_VIEWER_PATH);
  });
});

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

  it("embeds through the local viewer — navigation is always manual, no kiosk variant", () => {
    const url = "/media/deck.pptx";
    const encoded = encodeURIComponent(url);

    expect(mediaEmbedUrl("presentation", url)).toBe(`${SLIDES_VIEWER_PATH}?src=${encoded}`);
    expect(mediaEmbedUrl("presentation", url, { kiosk: true })).toBe(`${SLIDES_VIEWER_PATH}?src=${encoded}`);
  });

  it("reaches a screen as html pointed at the slides viewer", () => {
    const content = mediaAssetToWsContent({
      id: "m1",
      type: "presentation",
      url: "/media/deck.pptx",
      name: "Deck",
    });

    expect(content.type).toBe("html");
    expect(content.source).toContain(SLIDES_VIEWER_PATH);
    expect(content.source).not.toContain("kiosk");
  });
});

describe("word media type", () => {
  it("is a recognised media type, and not a link kind", () => {
    expect(isMediaType("word")).toBe(true);
    expect(isLinkMediaType("word")).toBe(false);
  });

  it("classifies a direct .docx link as a word document", () => {
    const classified = classifyLink("https://example.com/reports/q3-review.docx");
    expect(classified).toEqual({
      type: "word",
      url: "https://example.com/reports/q3-review.docx",
      name: "q3-review.docx",
    });
  });

  it("embeds through the local mammoth-backed viewer", () => {
    const url = "/media/report.docx";
    const encoded = encodeURIComponent(url);
    expect(mediaEmbedUrl("word", url)).toBe(`${WORD_VIEWER_PATH}?src=${encoded}`);
  });

  it("reaches a screen as html pointed at the viewer", () => {
    const content = mediaAssetToWsContent({
      id: "m2",
      type: "word",
      url: "/media/report.docx",
      name: "Report",
    });

    expect(content.type).toBe("html");
    expect(content.source).toContain(WORD_VIEWER_PATH);
  });
});

describe("normalizeUrl", () => {
  it("gives a bare host the scheme it obviously meant", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com/");
    expect(normalizeUrl("  www.example.com/a?b=1  ")).toBe("https://www.example.com/a?b=1");
  });

  it("leaves an explicit http(s) URL alone", () => {
    expect(normalizeUrl("http://example.com/x")).toBe("http://example.com/x");
  });

  it("rejects phrases and non-web schemes", () => {
    expect(normalizeUrl("hello world")).toBeNull();
    expect(normalizeUrl("localhost")).toBeNull();
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("mailto:a@b.com")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("file:///etc/passwd")).toBeNull();
  });
});

describe("classifyLink accepts whatever a client pastes", () => {
  it("takes a bare domain, storing the normalized URL", () => {
    expect(classifyLink("bbc.co.uk")).toEqual({
      type: "link",
      url: "https://bbc.co.uk/",
      name: "bbc.co.uk",
    });
  });

  it("plays a direct image or video URL natively instead of framing it", () => {
    expect(classifyLink("https://cdn.example.com/promo/hero.jpg?w=800")?.type).toBe("image");
    expect(classifyLink("https://cdn.example.com/reel.mp4")?.type).toBe("video");
    // Audio has no renderer of its own and goes through the video element.
    expect(classifyLink("https://cdn.example.com/jingle.mp3")?.type).toBe("video");
  });

  it("names a direct file link after the file", () => {
    expect(classifyLink("https://cdn.example.com/a/b/Q3%20Report.pdf")).toEqual({
      type: "document",
      url: "https://cdn.example.com/a/b/Q3%20Report.pdf",
      name: "Q3 Report.pdf",
    });
  });

  it("never rejects a usable address, however odd", () => {
    for (const raw of [
      "https://intranet.local:8443/dashboard#tab=2",
      "http://192.168.1.40/camera",
      "https://example.com/path with spaces".replace(/ /g, "%20"),
    ]) {
      expect(classifyLink(raw)).not.toBeNull();
    }
  });

  it("leaves a published Google Sheet as a plain page rather than a broken preview", () => {
    // "/d/e/<token>/pubhtml" has no file id to build a /preview URL from — the
    // published URL is already frameable and must be used as it stands.
    const classified = classifyLink(
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vABC/pubhtml"
    );
    expect(classified?.type).toBe("link");
    expect(mediaEmbedUrl("link", classified!.url)).toBe(classified!.url);
  });
});

describe("web pages that publish an embed endpoint", () => {
  it("routes Vimeo through the player, muted-autoplay only in kiosk", () => {
    const url = "https://vimeo.com/76979871";
    expect(mediaEmbedUrl("link", url)).toBe("https://player.vimeo.com/video/76979871");
    expect(mediaEmbedUrl("link", url, { kiosk: true })).toBe(
      "https://player.vimeo.com/video/76979871?autoplay=1&muted=1&loop=1"
    );
  });

  it("handles the other providers whose watch pages refuse framing", () => {
    expect(mediaEmbedUrl("link", "https://www.dailymotion.com/video/x8abcd")).toContain(
      "geo.dailymotion.com/player.html?video=x8abcd"
    );
    expect(mediaEmbedUrl("link", "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT")).toBe(
      "https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT"
    );
    expect(mediaEmbedUrl("link", "https://www.instagram.com/p/CxYz123/")).toBe(
      "https://www.instagram.com/p/CxYz123/embed"
    );
    expect(mediaEmbedUrl("link", "https://www.google.com/maps/place/Eiffel+Tower/@48.8,2.2")).toBe(
      "https://maps.google.com/maps?q=Eiffel%20Tower&output=embed"
    );
  });

  it("passes an ordinary page through untouched", () => {
    const url = "https://en.wikipedia.org/wiki/Digital_signage";
    expect(mediaEmbedUrl("link", url)).toBe(url);
  });

  it("reaches a screen as a framed page", () => {
    const content = mediaAssetToWsContent({
      id: "m2",
      type: "link",
      url: "https://vimeo.com/76979871",
      name: "Promo",
    });
    expect(content.type).toBe("html");
    expect(content.source).toContain("player.vimeo.com/video/76979871");
  });
});
