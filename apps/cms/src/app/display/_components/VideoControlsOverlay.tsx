"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Rewind, FastForward } from "lucide-react";
import { DragSlider } from "@/components/drag-slider";
import { scrubFrameTime } from "@/lib/display/scrub-preview";

/** Idle time before the chrome fades out again — matches PdfViewer. */
const CONTROLS_IDLE_MS = 3000;
/** Per-tap jump, matching the CMS transport. */
const SEEK_STEP_SECONDS = 10;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * Transport controls drawn over the video ON THE SCREEN ITSELF, so someone
 * standing at the 86" panel can operate it without the CMS.
 *
 * Auto-hides, because visitors see this panel and a permanent control bar over
 * signage looks like a mistake. Three things differ deliberately from
 * PdfViewer's otherwise-identical auto-hide chrome:
 *
 *  - The idle timer resets on INTERACTION only. PdfViewer resets on its view
 *    state too, and the video equivalent of that (currentTime) changes about
 *    four times a second — the controls would never hide at all.
 *  - The bar carries pointer-events-none while hidden, so a tap aimed at an
 *    invisible button passes through to the video and only reveals. Nothing is
 *    swallowed here: FiveTapCorner listens on document in the capture phase and
 *    would never see the first tap of its fullscreen escape gesture.
 *  - Bottom-anchored. FiveTapCorner's INTERACTIVE selector does not include
 *    role="slider", so a scrub bar inside the top-left 10vmin corner would eat
 *    that gesture.
 *
 * Rendered only on the real screen — see the `preview` guard in VideoRenderer.
 * Drives the element directly rather than going through the WS: the renderer's
 * own timeupdate/play/pause/seeked handlers report the result outward, so every
 * other client converges anyway.
 */
export function VideoControlsOverlay({
  videoRef,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const [visible, setVisible] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(true);
  /** Position under the scrub thumb while dragging; null when not dragging. */
  const [scrubTime, setScrubTime] = useState<number | null>(null);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether playback should be restored when the drag ends. */
  const scrubResumeRef = useRef(false);

  const reveal = useCallback(() => {
    setVisible(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setVisible(false), CONTROLS_IDLE_MS);
  }, []);

  // Mirror the element's own state — this bar is a view of the video, not the
  // owner of it, so a change made from the CMS shows up here too.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setTime(video.currentTime);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setPlaying(!video.paused);
    };
    sync();
    video.addEventListener("timeupdate", sync);
    video.addEventListener("play", sync);
    video.addEventListener("pause", sync);
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("seeked", sync);
    return () => {
      video.removeEventListener("timeupdate", sync);
      video.removeEventListener("play", sync);
      video.removeEventListener("pause", sync);
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("seeked", sync);
    };
  }, [videoRef]);

  // A touch panel produces no pointermove until a finger lands, so pointerdown
  // is what matters here. Passive by design — it reveals and nothing else.
  useEffect(() => {
    const onInteract = () => reveal();
    window.addEventListener("pointerdown", onInteract);
    window.addEventListener("pointermove", onInteract);
    return () => {
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("pointermove", onInteract);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [reveal]);

  const seekBy = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const max = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
    video.currentTime = Math.min(Math.max(video.currentTime + delta, 0), max);
    reveal();
  };

  const seekTo = (t: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(t)) return;
    const max = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
    video.currentTime = Math.min(Math.max(t, 0), max);
    reveal();
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
    reveal();
  };

  const scrubbable = duration > 0;
  const shownTime = scrubTime ?? time;

  return (
    <div
      // z-40: above PublishDragOverlay's z-30, well below FiveTapCorner's
      // z-[9999] escape hatch, which must always win.
      className={`fixed bottom-0 left-0 right-0 z-40 flex flex-col gap-3 bg-gradient-to-t from-black/80 to-transparent px-8 pb-8 pt-16 transition-opacity duration-300 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      {/* No preview thumbnail here, deliberately. This whole panel is already
          showing the scrubbed frame at full size — the video pauses and seeks
          along with the drag — so a 64px copy of it would add nothing and cost
          the kiosk a second decoder alongside the one already playing. The
          operator's tablet does show one, because there the frame is not
          otherwise visible. */}
      <DragSlider
        value={time}
        min={0}
        max={scrubbable ? duration : 1}
        disabled={!scrubbable}
        step={0.05}
        // Whole-second tracking is enforced in onChange below; this only paces
        // how often that is evaluated.
        commitMs={350}
        onChange={(v) => {
          // Quantised to the same one-frame-per-second grid the tablet previews
          // on, so both surfaces show the same frame while a drag is in flight.
          // The exact position is applied on release, in onPreviewEnd.
          seekTo(scrubFrameTime(v));
        }}
        onPreview={(v) => {
          if (scrubTime === null) {
            // Drag starting: hold the picture still so the frame being aimed at
            // stops moving out from under the finger.
            const video = videoRef.current;
            scrubResumeRef.current = video ? !video.paused : false;
            video?.pause();
          }
          setScrubTime(v);
          reveal();
        }}
        onPreviewEnd={() => {
          // Exact, not the previewed second — the drag is over, so land where
          // the finger actually stopped.
          if (scrubTime !== null) seekTo(scrubTime);
          setScrubTime(null);
          if (scrubResumeRef.current) {
            videoRef.current?.play().catch(() => {});
            scrubResumeRef.current = false;
          }
        }}
      />

      <div className="flex items-center gap-6">
        <button
          type="button"
          onClick={() => seekBy(-SEEK_STEP_SECONDS)}
          aria-label={`Rewind ${SEEK_STEP_SECONDS} seconds`}
          className="flex h-14 w-14 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Rewind className="h-7 w-7" />
        </button>
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
          className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
        >
          {playing ? <Pause className="h-8 w-8" /> : <Play className="h-8 w-8" />}
        </button>
        <button
          type="button"
          onClick={() => seekBy(SEEK_STEP_SECONDS)}
          aria-label={`Forward ${SEEK_STEP_SECONDS} seconds`}
          className="flex h-14 w-14 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
        >
          <FastForward className="h-7 w-7" />
        </button>
        <span className="ml-2 text-lg tabular-nums text-white/70">
          {formatTime(shownTime)}
          {duration > 0 && ` / ${formatTime(duration)}`}
        </span>
      </div>
    </div>
  );
}
