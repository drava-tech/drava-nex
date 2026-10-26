// Content shape for the Welcome template. Stored on the experience as
// experience.templateContent.welcome. A full-screen greeting with an
// optional video (plays once, holds on its last frame), shown when a human
// is detected while the default/idle video is playing (see door-screen-trigger.ts).

export interface WelcomeContent {
  title: string;
  subtitle?: string;
  // MediaAsset id/url of the picked video (see MediaPicker) — url is stored
  // alongside the id so the display page can render it without an extra
  // lookup (it only ever receives this plain JSON blob over the WS push).
  videoAssetId?: string;
  videoUrl?: string;
  // Runtime flags set by the API on the content it sends to the TV (see
  // apps/api/src/lib/welcome-policy.ts). They are never authored in the CMS or
  // stored on the experience.
  /** true = the video must play silent and cannot be unmuted from the screen. */
  muted?: boolean;
  /** false = don't read the headline aloud (a GREET voice line owns the audio). */
  narrate?: boolean;
}

export const DEFAULT_WELCOME_CONTENT: WelcomeContent = {
  title: "Welcome to Tusker Digital Experience Center",
  subtitle: "",
};

/** Reads the welcome content slice off an experience row, or null if unset. */
export function readWelcomeContent(
  templateContent: Record<string, unknown> | null | undefined
): WelcomeContent | null {
  const slice = templateContent?.["welcome"];
  return slice ? { ...DEFAULT_WELCOME_CONTENT, ...(slice as WelcomeContent) } : null;
}
