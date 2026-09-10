/**
 * Driving a <video> element as a scrub-preview thumbnail.
 *
 * The element is never played — it is seeked to the position under the scrub
 * thumb and shows that one frame.
 *
 * Two properties make this feel right rather than merely work:
 *
 * 1. It samples ONE FRAME PER SECOND of the timeline (SCRUB_FRAME_SECONDS).
 *    Dragging within the same second re-seeks nothing, so a 90-second clip has
 *    at most 90 preview frames however wildly the finger moves. This is also
 *    what YouTube does — its storyboards are sampled at about this rate — and it
 *    is why the preview stays steady instead of shimmering between neighbouring
 *    frames as the thumb wobbles.
 *
 * 2. It SELF-PACES off the element's own `seeked` event rather than a fixed
 *    timer: one seek in flight at a time, and the next is issued when the last
 *    reports done. A decoder can therefore never be asked for work faster than
 *    it can retire it — the failure a fixed throttle can only guess at — and on
 *    a fast machine it runs as quickly as the hardware allows.
 */

/**
 * The quantisation itself moved to @platform/ui (lib/playback-sync.ts) — the
 * Portfolio film player's scrub bar has to snap to the SAME grid as this one,
 * or the two surfaces would disagree about which frame a position means. Both
 * names stay exported from here, where every existing importer looks for them.
 */
import { SCRUB_FRAME_SECONDS, scrubFrameTime } from "@platform/ui/playback-sync";

export { SCRUB_FRAME_SECONDS, scrubFrameTime };

export interface ScrubPreview {
  /** Ask for the frame at `time`. Quantised and paced; safe to call per pointer move. */
  seek(time: number): void;
  /** Forget the last position and detach, so the next drag starts clean. */
  reset(): void;
}

/**
 * `getVideo` rather than an element: consumers mount their preview element
 * lazily on first drag, so there is nothing to bind at creation time.
 */
export function createScrubPreview(getVideo: () => HTMLVideoElement | null): ScrubPreview {
  /** The newest requested frame, waiting for the decoder to become free. */
  let pending: number | null = null;
  /** The frame currently being decoded, or null when idle. */
  let inFlight: number | null = null;
  /** The element we attached `seeked` to, so it can be detached again. */
  let bound: HTMLVideoElement | null = null;

  const issue = (video: HTMLVideoElement, target: number) => {
    inFlight = target;
    try {
      // Exact, not fastSeek: fastSeek snaps to the nearest keyframe, which on a
      // sparsely-keyframed clip can be seconds away from the requested second
      // and makes the preview disagree with its own timestamp.
      video.currentTime = target;
    } catch {
      // Seeking before the element is ready throws in some engines; drop this
      // one and let the next pointer move retry.
      inFlight = null;
    }
  };

  const pump = () => {
    const video = getVideo();
    if (!video || inFlight !== null || pending === null) return;
    const target = pending;
    pending = null;
    issue(video, target);
  };

  const onSeeked = () => {
    inFlight = null;
    pump();
  };

  const bind = (video: HTMLVideoElement) => {
    if (bound === video) return;
    bound?.removeEventListener("seeked", onSeeked);
    bound = video;
    // `error` too: a failed seek never fires `seeked`, and without this the
    // pump would stay blocked on an in-flight request that can never complete.
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onSeeked);
  };

  return {
    seek(time: number) {
      const video = getVideo();
      if (!video || !Number.isFinite(time)) return;
      bind(video);

      const max = Number.isFinite(video.duration) ? video.duration : undefined;
      const clamped = Math.max(0, max === undefined ? time : Math.min(time, max));
      const target = scrubFrameTime(clamped);

      // Same second as what is showing or already queued — nothing to do.
      if (target === inFlight || target === pending) return;
      if (inFlight === null && bound && Math.abs(bound.currentTime - target) < SCRUB_FRAME_SECONDS / 2) {
        return;
      }

      pending = target;
      pump();
    },
    reset() {
      pending = null;
      inFlight = null;
      bound?.removeEventListener("seeked", onSeeked);
      bound?.removeEventListener("error", onSeeked);
      bound = null;
    },
  };
}
