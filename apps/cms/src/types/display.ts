// ─── Screen ──────────────────────────────────────────────────────────────────

import type { WsContent } from "@platform/types";

export interface Screen {
  screenId: string;
  screenName: string;
  contentId: string;
  currentContent?: WsContent;
}

export interface ScreensConfig {
  screens: Screen[];
}

// ─── Content ─────────────────────────────────────────────────────────────────

export type ContentType = "video" | "image" | "html" | "stream" | "experience" | "webpage";

export interface BaseContent {
  id: string;
  type: ContentType;
}

export interface VideoContent extends BaseContent {
  type: "video";
  source: string;
  loop: boolean;
  muted: boolean;
}

export interface ImageContent extends BaseContent {
  type: "image";
  source: string;
}

export interface HtmlContent extends BaseContent {
  type: "html";
  source: string;
}

export interface StreamContent extends BaseContent {
  type: "stream";
  source: string;
  muted?: boolean;
}

/** A "link" media asset, rendered server-side by services/browser-render instead
 * of an iframe (see packages/types/src/media-content.ts mediaAssetToWsContent). */
export interface WebpageContent extends BaseContent {
  type: "webpage";
  source: string;
}

export interface ExperienceContent extends BaseContent {
  type: "experience";
  title?: string;
  /** Code-defined template assigned to the experience (e.g. "portfolio"). */
  templateKey?: string;
  /** Per-template authored content, keyed by templateKey. */
  templateContent?: Record<string, unknown>;
}

export type Content =
  | VideoContent
  | ImageContent
  | HtmlContent
  | StreamContent
  | WebpageContent
  | ExperienceContent;

export interface ContentsConfig {
  contents: Content[];
}

// ─── Resolved Display Config ──────────────────────────────────────────────────

export interface DisplayConfig {
  screen: Screen;
  content: Content;
  interactionEnabled: boolean;
}
