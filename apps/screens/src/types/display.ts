// ─── Screen ──────────────────────────────────────────────────────────────────

export interface Screen {
  screenId: string;
  screenName: string;
  contentId: string;
}

export interface ScreensConfig {
  screens: Screen[];
}

// ─── Content ─────────────────────────────────────────────────────────────────

export type ContentType = "video" | "image" | "html" | "stream";

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

export type Content = VideoContent | ImageContent | HtmlContent | StreamContent;

export interface ContentsConfig {
  contents: Content[];
}

// ─── Resolved Display Config ──────────────────────────────────────────────────

export interface DisplayConfig {
  screen: Screen;
  content: Content;
}
