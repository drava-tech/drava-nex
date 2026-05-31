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

export type ContentType = "video" | "stream" | "experience";

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

// Union — extend here as new content types are added
export type Content = VideoContent;

export interface ContentsConfig {
  contents: Content[];
}

// ─── Resolved Display Config ──────────────────────────────────────────────────

export interface DisplayConfig {
  screen: Screen;
  content: Content;
}
