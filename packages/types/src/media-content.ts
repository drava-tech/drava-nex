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
  if (kind && id) return { kind: kind as DriveRef["kind"], id };

  // Legacy share shapes: /open?id=<id> and /uc?id=<id>.
  const queryId = u.searchParams.get("id");
  return queryId ? { kind: "file", id: queryId } : null;
}

/**
 * Work out what a pasted URL is, and a reasonable display name for it. Returns
 * null when the string isn't a usable http(s) URL at all.
 */
export function classifyLink(raw: string): { type: MediaType; url: string; name: string } | null {
  const u = safeUrl(raw);
  if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) return null;

  const url = u.toString();

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

  // A direct link to a file we can render better than a bare iframe.
  const ext = (u.pathname.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  if (ext === "pdf") return { type: "document", url, name: u.pathname.split("/").pop() || "Document" };
  if (ext === "xlsx" || ext === "csv") {
    return { type: "sheet", url, name: u.pathname.split("/").pop() || "Spreadsheet" };
  }
  if (ext === "pptx") {
    return { type: "presentation", url, name: u.pathname.split("/").pop() || "Presentation" };
  }

  return { type: "link", url, name: u.hostname.replace(/^www\./, "") };
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

  if (isMediaType(asset.type)) {
    return { ...base, type: "html", source: mediaEmbedUrl(asset.type, asset.url, { kiosk: true }) };
  }

  // Unrecognised kind — keep the pre-existing behaviour of treating anything
  // that isn't a video as an image rather than blanking the screen.
  return { ...base, type: "image", source: asset.url };
}
