"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Loader2, Rewind, FastForward } from "lucide-react";
import { DragSlider } from "@/components/drag-slider";
import { useScreenPlayback } from "@/hooks/useScreenPlayback";
import { createScrubPreview } from "@/lib/display/scrub-preview";
import { SCRUB_TRACK_INTERVAL_MS } from "@/lib/display/playback-protocol";

/** Per-gesture jump, matching the buttons on the on-screen overlay. */
const SEEK_STEP_SECONDS = 10;
/** Where the still is taken from. Not 0 — many encodes open on a black frame. */
const POSTER_SECONDS = 0.1;
/**
 * How long a first tap waits to find out whether it is half of a double.
 *
 * This is why the play/pause BUTTON stays: a tap cannot act sooner than this
 * without occasionally pausing a video the operator was only trying to skip
 * through, whereas the button fires the instant it is pressed.
 */
const DOUBLE_TAP_MS = 250;
/** How long the seek confirmation stays up after a double-tap. */
const SEEK_FLASH_MS = 600;

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
 * Transport for a video playing on a screen — a control surface, NOT a mirror.
 *
 * The panel this replaced embedded a full ScreenMirror iframe, decoding the
 * same file a second time purely so the operator had something to look at. The
 * video is decoded once, on the screen; this shows its true position instead
 * (see useScreenPlayback).
 *
 * The still below is a single decoded frame from a metadata-only element that
 * is never played, and it does double duty: at rest it identifies WHICH video
 * is live, and during a drag it becomes the scrub preview, seeking to the
 * position under the thumb. That is why there is no second element for previews
 * here — unlike the on-screen overlay, which has no still to borrow.
 */
export function VideoControlPanel({
  screenId,
  source,
  contentName,
}: {
  screenId: string;
  /** The video URL live on the screen. */
  source: string | undefined;
  contentName?: string;
}) {
  const posterRef = useRef<HTMLVideoElement>(null);
  const thumbVideoRef = useRef<HTMLVideoElement>(null);
  const { time, duration, playing, known, seekBy, togglePlay, beginScrub, scrubTo, endScrub } =
    useScreenPlayback(screenId, source);

  /** Position under the scrub thumb while dragging; null when not dragging. */
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  /**
   * The thumbnail element is mounted only once a drag starts. A panel nobody is
   * touching should not hold a second decoder open, and most never will be.
   */
  const [thumbMounted, setThumbMounted] = useState(false);
  /** Which side was double-tapped, for the confirmation flash. */
  const [seekFlash, setSeekFlash] = useState<"back" | "forward" | null>(null);

  // Its own element, not the poster: the poster is occupying the main area and
  // one element cannot be in two places. Two metadata-only decoders is a cost
  // the tablet can carry — it is exactly the cost that was unacceptable on the
  // kiosk, which is why the 86" screen has no thumbnail at all.
  const previewRef = useRef(createScrubPreview(() => thumbVideoRef.current));
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The last position the slider committed. DragSlider fires its final
   * onChange on pointerup and onPreviewEnd immediately after, so this is where
   * the finger actually stopped — a fraction ahead of the last onPreview, and
   * the value the screen should end up at.
   */
  const lastScrubRef = useRef<number | null>(null);

  // Seed the still once metadata is in. Deliberately NOT kept in step with
  // playback — that would be a mirror, one frame at a time.
  useEffect(() => {
    const el = posterRef.current;
    if (!el) return;
    previewRef.current.reset();
    const onMeta = () => {
      try {
        el.currentTime = Math.min(POSTER_SECONDS, el.duration || POSTER_SECONDS);
      } catch {
        /* a seek before the buffer exists is rejected by some browsers; the
           first frame is a fine fallback */
      }
    };
    el.addEventListener("loadedmetadata", onMeta);
    return () => el.removeEventListener("loadedmetadata", onMeta);
  }, [source]);

  useEffect(() => {
    return () => {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const flash = useCallback((side: "back" | "forward") => {
    setSeekFlash(side);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setSeekFlash(null), SEEK_FLASH_MS);
  }, []);

  /**
   * One tap toggles playback; two on the same side seek. The pending single tap
   * is cancelled the moment a second arrives, so a double-tap never also
   * toggles play — which would be the worst of both outcomes.
   */
  const handleTap = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const side: "back" | "forward" = e.clientX - rect.left < rect.width / 2 ? "back" : "forward";

      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
        seekBy(side === "back" ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS);
        flash(side);
        return;
      }
      tapTimerRef.current = setTimeout(() => {
        tapTimerRef.current = null;
        togglePlay();
      }, DOUBLE_TAP_MS);
    },
    [seekBy, togglePlay, flash]
  );

  const scrubbable = duration > 0;
  const shownTime = scrubTime ?? time;
  /** Horizontal position of the thumbnail, as a percentage of the track. */
  const thumbPct = scrubbable && scrubTime !== null ? (scrubTime / duration) * 100 : 0;

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 p-4">
      <div
        onClick={source ? handleTap : undefined}
        className={`relative flex min-h-0 flex-1 select-none items-center justify-center overflow-hidden rounded-xl bg-black ${
          source ? "cursor-pointer" : ""
        }`}
      >
        {source ? (
          <video
            ref={posterRef}
            key={source}
            src={source}
            preload="metadata"
            muted
            playsInline
            className="pointer-events-none max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-sm text-zinc-500">Nothing playing</span>
        )}

        {/* The poster no longer changes while scrubbing — the preview moved to
            a thumbnail at the slider, where the finger already is. A still that
            looked like a live view would be worse than no image. */}
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-white/70">
          Poster · not a live view
        </span>

        {/* A gesture with no button has to say that it landed. */}
        {seekFlash && (
          <span
            className={`pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-black/70 px-3 py-2 text-sm font-semibold text-white ${
              seekFlash === "back" ? "left-6" : "right-6"
            }`}
          >
            {seekFlash === "back" ? (
              <>
                <Rewind className="h-4 w-4" /> {SEEK_STEP_SECONDS}s
              </>
            ) : (
              <>
                {SEEK_STEP_SECONDS}s <FastForward className="h-4 w-4" />
              </>
            )}
          </span>
        )}

        {source && (
          <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/60 px-2 py-1 text-[9px] uppercase tracking-widest text-white/50">
            Tap to play · double-tap to skip
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {contentName && (
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {contentName}
          </p>
        )}

        <div className="relative">
          {/* Thumbnail above the thumb, tracking it horizontally — the YouTube
              position, and the reason the poster no longer changes. */}
          {scrubTime !== null && thumbMounted && source && (
            <div
              className="pointer-events-none absolute bottom-8 z-10 w-48 -translate-x-1/2 overflow-hidden rounded-lg border border-white/20 bg-black shadow-2xl"
              style={{ left: `${thumbPct}%` }}
            >
              <video
                ref={thumbVideoRef}
                src={source}
                preload="metadata"
                muted
                playsInline
                className="block h-28 w-full object-contain"
              />
              <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1.5 py-0.5 text-xs tabular-nums text-white">
                {formatTime(scrubTime)}
              </span>
            </div>
          )}

          <DragSlider
            value={time}
            min={0}
            max={scrubbable ? duration : 1}
            disabled={!scrubbable}
            // Sub-second precision so the release lands exactly where the finger
            // stopped, even though the PREVIEW is quantised to whole seconds.
            step={0.05}
            // Tracking is paced inside scrubTo (frame gate + interval gate), so
            // this only has to not fight it.
            commitMs={SCRUB_TRACK_INTERVAL_MS}
            onChange={(v) => {
              lastScrubRef.current = v;
              scrubTo(v);
            }}
            onPreview={(v) => {
              if (!thumbMounted) {
                setThumbMounted(true);
                beginScrub();
              }
              setScrubTime(v);
              previewRef.current.seek(v);
            }}
            onPreviewEnd={() => {
              endScrub(lastScrubRef.current ?? time);
              lastScrubRef.current = null;
              setScrubTime(null);
              previewRef.current.reset();
              // Drop the second decoder rather than leaving it holding buffers
              // for a drag that has finished.
              setThumbMounted(false);
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? "Pause" : "Play"}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-900 text-zinc-50 transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {playing ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
          </button>

          <span className="ml-2 text-sm tabular-nums text-zinc-500 dark:text-zinc-400">
            {formatTime(shownTime)}
            {scrubbable && ` / ${formatTime(duration)}`}
          </span>

          <span className="ml-auto flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
            {known ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                <span className="text-zinc-500 dark:text-zinc-400">Live</span>
              </>
            ) : (
              <>
                <Loader2 className="h-3 w-3 animate-spin text-zinc-400" />
                {/* Honest: until the screen reports, this panel does not know
                    where the video is, and must not pretend to. */}
                <span className="text-zinc-400">Waiting for screen</span>
              </>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
