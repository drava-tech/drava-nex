// Media library → display content mapping.
//
// A media asset is just a `type` (free text) + a `url`, and a screen points at
// one by id. This module is the single place that decides how each kind
// actually reaches a display: natively (image/video), or through the
// full-screen sandboxed iframe the existing `html` wire type already gives us
// (PDF, spreadsheets, YouTube, Drive, plain links).
//
// Deliberately pure and dependency-free so the DB query layer, the API and the
// CMS all derive the exact same URL — the media preview in the CMS shows the
// literal embed the screen will load, so "verify then push" means something.

import type { WsContent } from "./index.js";

/**
 * Kinds a media-library asset can be. Stored as free text in media_asset.type
 * (there is no DB enum), so adding a kind needs no migration — only a branch in
 * mediaEmbedUrl() below.
 */
export const MEDIA_TYPES = [
  "image",
  "video",
  "document", // PDF
  "sheet", // .xlsx / .csv spreadsheet
  "presentation", // .pptx slide deck
  "youtube",
  "drive", // Google Drive file, Docs, Sheets or Slides
  "link", // any other embeddable web page
] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];

export function isMediaType(value: unknown): value is MediaType {
  return typeof value === "string" && (MEDIA_TYPES as readonly string[]).includes(value);
}

/** Kinds added by pasting a URL rather than uploading a file. */
const LINK_MEDIA_TYPES: readonly string[] = ["youtube", "drive", "link"];

export function isLinkMediaType(type: string): boolean {
  return LINK_MEDIA_TYPES.includes(type);
}

/** Path of the CMS-hosted spreadsheet viewer (see apps/cms/src/app/display/sheet). */
export const SHEET_VIEWER_PATH = "/display/sheet";

/** Path of the CMS-hosted slide-deck viewer (see apps/cms/src/app/display/slides). */
export const SLIDES_VIEWER_PATH = "/display/slides";

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

/**
 * Accept what people actually paste — "example.com" as readily as a full URL,
 * and a stray "www.example.com/x?y=1" with whitespace around it. Returns null
 * for anything that isn't a usable http(s) address (a search phrase, a
 * mailto:/file: scheme, an empty string).
 *
 * Shared so the Add-link dialog, the Browser omnibox and the API all accept
 * exactly the same set of inputs — a link the CMS shows as valid can never be
 * one the server then rejects.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Anything already carrying a scheme is taken at its word — and rejected here
  // if that scheme isn't web. Catching it before the fallback below matters:
  // "mailto:a@b.com" has no slash and does have a dot, so it would otherwise be
  // read as a bare host and prefixed into a URL pointing somewhere else
  // entirely. The (?!\d) keeps "example.com:8080" a host and port, not a scheme.
  if (/^[a-z][a-z0-9+.-]*:(\/\/|(?!\d))/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  // A bare host/path gets the scheme it obviously meant. Anything with a space
  // or without a dot is a phrase, not an address, so it fails the parse below.
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^[^\s/]+\.[^\s/]/.test(trimmed)
      ? `https://${trimmed}`
      : trimmed;

  const u = safeUrl(candidate);
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) return null;
  return u.toString();
}

/**
 * Direct links to a file we can play natively instead of framing. Keyed by the
 * URL's extension, so a client pasting a CDN image or an .mp4 gets a real
 * image/video asset — looping, muted playback on a screen — rather than a page
 * embed with browser chrome around it.
 *
 * Note this is deliberately wider than the *upload* allowlist in the API: we
 * host uploads ourselves (so an .svg would be a stored-XSS risk on our own
 * origin), whereas these stay on the client's server and are only ever loaded
 * into an <img>/<video>, which doesn't execute them.
 */
const EXT_MEDIA_TYPES: Record<string, MediaType> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  avif: "image", bmp: "image", ico: "image", svg: "image",

  mp4: "video", webm: "video", mov: "video", m4v: "video", mkv: "video",
  ogv: "video", ogg: "video",
  // Audio has no screen renderer of its own; <video> plays it fine (with no
  // picture), which is the honest result of putting an .mp3 on a display.
  mp3: "video", m4a: "video", aac: "video", wav: "video", flac: "video",
  oga: "video", opus: "video",

  pdf: "document",
  xlsx: "sheet", csv: "sheet",
  pptx: "presentation",
};

/** Extract a video id from any of the URL shapes YouTube hands out. */
export function parseYouTubeId(raw: string): string | null {
  const u = safeUrl(raw);
  if (!u) return null;

  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  let id = "";

  if (host === "youtu.be") {
    id = u.pathname.split("/")[1] ?? "";
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    // /watch?v=<id>, plus the /embed, /shorts, /live and /v path forms.
    id = u.searchParams.get("v") ?? u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1] ?? "";
  }

  return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

export interface DriveRef {
  /** Drive path segment, which also picks the host (file → drive.google.com, rest → docs.google.com). */
  kind: "file" | "document" | "spreadsheets" | "presentation";
  id: string;
}

/** Extract the file/doc id and kind from a Drive, Docs, Sheets or Slides URL. */
export function parseDriveRef(raw: string): DriveRef | null {
  const u = safeUrl(raw);
  if (!u) return null;

  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (host !== "drive.google.com" && host !== "docs.google.com") return null;

  const match = u.pathname.match(/^\/(file|document|spreadsheets|presentation)\/d\/([^/?#]+)/);
  const kind = match?.[1];
  const id = match?.[2];
  // "/d/e/<token>/pubhtml" is a *published* doc, not a file id — the id slot
  // holds the literal "e". Those URLs are already frameable as they stand, so
  // fall through and let them load directly rather than building a /preview
  // URL out of a segment that isn't an id.
  if (kind && id && id !== "e") return { kind: kind as DriveRef["kind"], id };

  // Legacy share shapes: /open?id=<id> and /uc?id=<id>.
  const queryId = u.searchParams.get("id");
  return queryId ? { kind: "file", id: queryId } : null;
}

/**
 * Work out what a pasted URL is, and a reasonable display name for it. Returns
 * null when the string isn't a usable http(s) URL at all.
 */
export function classifyLink(raw: string): { type: MediaType; url: string; name: string } | null {
  const url = normalizeUrl(raw);
  if (!url) return null;

  const u = new URL(url);

  if (parseYouTubeId(url)) return { type: "youtube", url, name: "YouTube video" };

  const drive = parseDriveRef(url);
  if (drive) {
    const label =
      drive.kind === "spreadsheets" ? "Google Sheet"
      : drive.kind === "document" ? "Google Doc"
      : drive.kind === "presentation" ? "Google Slides"
      : "Drive file";
    return { type: "drive", url, name: label };
  }

  // A direct link to a file we can render better than a bare iframe. Matched on
  // the path only, so a CDN's "?w=800&token=…" query doesn't hide the extension.
  const ext = (u.pathname.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  const extType = EXT_MEDIA_TYPES[ext];
  if (extType) {
    const fileName = decodeURIComponent(u.pathname.split("/").pop() || "");
    return { type: extType, url, name: fileName || u.hostname.replace(/^www\./, "") };
  }

  // Everything else is a web page. Never rejected — whatever the client pastes
  // gets a row, and mediaEmbedUrl() below works out how to actually show it.
  return { type: "link", url, name: u.hostname.replace(/^www\./, "") };
}

/**
 * Rewrite a page URL into the embeddable player/preview its host publishes,
 * where one exists.
 *
 * This matters more than it looks: these sites all send framing headers on
 * their *watch* pages, so a pasted vimeo.com/… link renders as a blank
 * rectangle on a screen. Their embed endpoints are built to be framed, so
 * routing through them is the only way this works on a display machine that
 * doesn't have the Frame Unlock extension installed.
 *
 * Returns null when we know of no rewrite — the URL is then used as-is.
 */
function providerEmbedUrl(u: URL, kiosk: boolean): string | null {
  const host = u.hostname.replace(/^www\./, "").toLowerCase();

  // Vimeo: /<id>, /channels/<name>/<id>, /video/<id> — take the first numeric
  // path segment, which is the video id in every one of those shapes.
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.match(/\/(\d+)(?:$|[/?#])/)?.[1];
    if (id) {
      const params = new URLSearchParams();
      if (kiosk) {
        // Unlike YouTube, Vimeo honours muted autoplay reliably; unmuted
        // autoplay is refused outright, so don't ask for it.
        params.set("autoplay", "1");
        params.set("muted", "1");
        params.set("loop", "1");
      }
      const query = params.toString();
      return `https://player.vimeo.com/video/${id}${query ? `?${query}` : ""}`;
    }
  }

  if (host === "dailymotion.com" || host === "dai.ly") {
    const id =
      host === "dai.ly"
        ? u.pathname.slice(1).split("/")[0]
        : u.pathname.match(/^\/video\/([^/?#]+)/)?.[1];
    if (id) {
      return `https://geo.dailymotion.com/player.html?video=${encodeURIComponent(id)}${
        kiosk ? "&autoplay=1&mute=1" : ""
      }`;
    }
  }

  if (host === "open.spotify.com") {
    const match = u.pathname.match(/^\/(track|album|playlist|episode|show|artist)\/([^/?#]+)/);
    if (match) return `https://open.spotify.com/embed/${match[1]}/${match[2]}`;
  }

  if (host === "soundcloud.com") {
    return `https://w.soundcloud.com/player/?url=${encodeURIComponent(u.toString())}${
      kiosk ? "&auto_play=true" : ""
    }`;
  }

  if (host === "instagram.com") {
    const match = u.pathname.match(/^\/(p|reel|tv)\/([^/?#]+)/);
    if (match) return `https://www.instagram.com/${match[1]}/${match[2]}/embed`;
  }

  // Google Maps. The modern /maps/place/… URLs can't be framed, but the legacy
  // "?output=embed" endpoint can and accepts the same place query.
  if (host === "maps.google.com" || (/^google\.[a-z.]+$/.test(host) && u.pathname.startsWith("/maps"))) {
    const place = u.pathname.match(/\/maps\/place\/([^/?#]+)/)?.[1];
    const query = u.searchParams.get("q") ?? place;
    if (query) {
      return `https://maps.google.com/maps?q=${encodeURIComponent(
        decodeURIComponent(query).replace(/\+/g, " ")
      )}&output=embed`;
    }
  }

  return null;
}

export interface EmbedOptions {
  /**
   * Unattended full-screen playback on a physical screen: autoplay, muted,
   * looping, viewer chrome hidden. Off for the CMS preview, where a human is
   * looking at it and wants controls.
   */
  kiosk?: boolean;
}

/**
 * The URL to actually load for an asset. For image/video this is the asset URL
 * unchanged; for everything else it's an embeddable page for an iframe.
 */
export function mediaEmbedUrl(type: string, url: string, opts: EmbedOptions = {}): string {
  const kiosk = opts.kiosk ?? false;

  switch (type) {
    case "document":
      // Browsers render PDFs natively in an iframe. These are PDF Open
      // Parameters — on a screen we hide the toolbar so it reads as content,
      // not as a document someone left open.
      return kiosk ? `${url}#toolbar=0&navpanes=0&scrollbar=0&view=FitH` : `${url}#view=FitH`;

    case "sheet":
      // Rendered by our own client-side viewer rather than a hosted Office/
      // Google viewer, which would require the file to be reachable from the
      // public internet — signage servers usually aren't.
      return `${SHEET_VIEWER_PATH}?src=${encodeURIComponent(url)}`;

    case "presentation":
      // Same reasoning as "sheet" above — our own client-side renderer rather
      // than a hosted Office viewer. On a screen there's nobody to click
      // through the deck, so kiosk mode hides the controls and auto-advances.
      return `${SLIDES_VIEWER_PATH}?src=${encodeURIComponent(url)}${kiosk ? "&kiosk=1" : ""}`;

    case "youtube": {
      const id = parseYouTubeId(url);
      if (!id) return url;
      const params = new URLSearchParams({ rel: "0", modestbranding: "1", playsinline: "1" });
      if (kiosk) {
        // Autoplay may be blocked by browsers unless launched with specific flags
        // (e.g., --autoplay-policy=no-user-gesture-required).
        // ponytail: assuming kiosk environment allows unmuted autoplay.
        // `loop` additionally requires `playlist` to be the same id.
        params.set("autoplay", "1");
        params.set("controls", "0");
        params.set("loop", "1");
        params.set("playlist", id);
      }
      return `https://www.youtube.com/embed/${id}?${params.toString()}`;
    }

    case "drive": {
      const ref = parseDriveRef(url);
      if (!ref) return url;
      const host = ref.kind === "file" ? "drive.google.com" : "docs.google.com";
      return `https://${host}/${ref.kind}/d/${ref.id}/preview`;
    }

    case "link": {
      const u = safeUrl(url);
      return (u && providerEmbedUrl(u, kiosk)) ?? url;
    }

    default:
      return url;
  }
}

/**
 * Resolve a media asset row into the wire content a screen renders. Anything
 * that isn't natively playable becomes `html` — an embed URL in the display
 * app's sandboxed full-screen iframe.
 */
export function mediaAssetToWsContent(
  asset: { id: string; type: string; url: string; name?: string | null },
  opts: { loop?: boolean; muted?: boolean } = {}
): WsContent {
  const base = {
    id: asset.id,
    title: asset.name ?? undefined,
    ...(opts.loop !== undefined ? { loop: opts.loop } : {}),
    ...(opts.muted !== undefined ? { muted: opts.muted } : {}),
  };

  if (asset.type === "video") {
    return { ...base, type: "video", source: asset.url };
  }

  if (asset.type === "image") {
    return { ...base, type: "image", source: asset.url };
  }

  if (asset.type === "link") {
    // Rendered server-side by services/browser-render (real headless Chromium,
    // top-level navigation) instead of an iframe — sites that send
    // X-Frame-Options/CSP frame-ancestors never trigger those checks this way,
    // and every viewer (the physical screen, a CMS mirror, or another device)
    // shares the same live session instead of an independent iframe each,
    // which is what actually lets one of them control what the others see.
    // Everything else stays in the iframe/mediaEmbedUrl path below: PDFs,
    // sheets, decks, YouTube and Drive already have purpose-built embeds and
    // aren't the case that breaks.
    return { ...base, type: "webpage", source: asset.url };
  }

  if (isMediaType(asset.type)) {
    return { ...base, type: "html", source: mediaEmbedUrl(asset.type, asset.url, { kiosk: true }) };
  }

  // Unrecognised kind — keep the pre-existing behaviour of treating anything
  // that isn't a video as an image rather than blanking the screen.
  return { ...base, type: "image", source: asset.url };
}
