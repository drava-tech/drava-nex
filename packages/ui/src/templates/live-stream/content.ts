// Content shape for the Live Stream template. Stored on the experience as
// experience.templateContent["live-stream"]. The Experience points to ONE streamId;
// a publisher EXE pushes that stream and any TV showing this experience plays it.
// Shared by the CMS (editor + preview) and the screens app (live render).

export type StreamFit = "cover" | "contain";

export interface LiveStreamContent {
  /** The stream this experience plays. A publisher EXE must STREAM_PUBLISH this id. */
  streamId: string;
  /** Optional caption shown over the live feed. */
  label?: string;
  /** How the video fills the screen. Defaults to "cover". */
  fit?: StreamFit;
}

export const DEFAULT_LIVE_STREAM_CONTENT: LiveStreamContent = {
  streamId: "",
  label: "",
  fit: "cover",
};

/** Reads the live-stream content slice off an experience row, or null if unset. */
export function readLiveStreamContent(
  templateContent: Record<string, unknown> | null | undefined
): LiveStreamContent | null {
  const slice = templateContent?.["live-stream"];
  return slice ? (slice as LiveStreamContent) : null;
}
