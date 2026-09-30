/**
 * The transport-neutral half of screen playback synchronisation: the absolute
 * state shape, the timings both ends have to agree on, the throttled emitter,
 * and the tolerant apply.
 *
 * Lives here rather than in the CMS's own `lib/display/playback-protocol.ts`
 * because it is now shared with the Portfolio template's film player, which
 * lives in this package and cannot reach into `apps/cms`. That file keeps the
 * MEDIA_ and SET_PLAYBACK command names — those ARE the CMS↔screen wire protocol —
 * and re-exports everything below, so no existing CMS import changed.
 *
 * The reason to share rather than copy is not tidiness: SEEK_TOLERANCE_SECONDS
 * and PLAYBACK_EMIT_THROTTLE_MS have to stay in a fixed relationship to each
 * other (see the comment on the tolerance), and two drifting copies would show
 * up as a video that stutters roughly once a second.
 */

/**
 * Absolute playback state. `src` travels with it and is checked on apply,
 * because the replay buffer is keyed by command name rather than by content —
 * a position left over from a previously-shown video must never be applied to
 * whatever is on screen now.
 */
export interface PlaybackState {
  src: string;
  /** Seconds from the start. */
  time: number;
  playing: boolean;
  /**
   * Total length in seconds, so a remote scrub bar has a scale to draw.
   *
   * OPTIONAL, and it has to stay that way: the gateway's viewStateCache lives
   * in the API container while the display page is served by the CMS one, and
   * those restart independently — a rebuilt display can absolutely be replayed
   * a value recorded before this field existed.
   *
   * Only ever set when Number.isFinite(video.duration). It is NaN before
   * loadedmetadata and Infinity for some streams, and JSON.stringify turns NaN
   * into null — which is neither undefined nor NaN and slips straight past an
   * undefined check, painting a broken bar. Guard at the source, not here.
   */
  duration?: number;
}

/** How often a playing item reports its position while nothing else happens. */
export const PLAYBACK_EMIT_THROTTLE_MS = 1000;

/**
 * How far out a reported position must be before it's worth seeking to.
 * The gateway echoes every SET_PLAYBACK back to the screen that sent it, so
 * applying each one unconditionally would fight the player's own playback
 * roughly once a second and visibly stutter the picture. Comfortably above
 * the emit throttle, so normal drift never triggers a seek.
 */
export const SEEK_TOLERANCE_SECONDS = 1.5;

/**
 * How long a remote scrub bar keeps its own value authoritative after the user
 * lets go.
 *
 * Releasing the thumb hands control straight back to the inbound stream, but
 * the next message may still carry the PRE-seek position — either in flight, or
 * emitted just before the throttle window closed. Without a settle window the
 * thumb visibly jumps backwards for up to a second and then forwards again.
 * Comfortably longer than the 1s emit throttle so the corrected value has
 * certainly arrived.
 */
export const PLAYBACK_SETTLE_MS = 1200;

/**
 * How often a scrub tells the screen where it is now.
 *
 * ~8 a second: fast enough that the picture reads as tracking the finger,
 * gentle enough that a kiosk decoder can retire each seek before the next
 * arrives. The preview thumbnail on the operator's own device is NOT paced by
 * this — it self-paces off `seeked` (see scrub-preview.ts), because that cost
 * lands on the tablet rather than on the signage PC.
 */
export const SCRUB_TRACK_INTERVAL_MS = 120;

/**
 * Timeline granularity of a scrub, in seconds.
 *
 * One frame per second: enough to find a moment in a signage clip, few enough
 * that a whole drag costs a bounded number of seeks. This is also what YouTube
 * does — its storyboards are sampled at about this rate — and it is why a
 * scrubbed picture stays steady instead of shimmering between neighbouring
 * frames as the thumb wobbles.
 */
export const SCRUB_FRAME_SECONDS = 1;

/** Snap a position to the frame a scrub would show for it. */
export function scrubFrameTime(time: number): number {
  if (!Number.isFinite(time) || time < 0) return 0;
  return Math.floor(time / SCRUB_FRAME_SECONDS) * SCRUB_FRAME_SECONDS;
}

/**
 * Throttled emitter with a guaranteed trailing send — the same shape as
 * PdfViewer's emitView. `timeupdate` fires ~4x/second and the YouTube poll
 * can't be slowed below its interval, so without this the socket would carry
 * several messages a second per screen and thrash the gateway's LRU. Always
 * sends the newest value, and `flush()` bypasses the throttle so a pause or a
 * seek records its exact frame rather than one up to a second stale.
 */
export function createPlaybackEmitter(send: (state: PlaybackState) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: PlaybackState | null = null;
  let lastSentAt = 0;

  const flushNow = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const next = pending;
    if (!next) return;
    pending = null;
    lastSentAt = Date.now();
    send(next);
  };

  return {
    /** Throttled — for the steady drip of position updates while playing. */
    emit(state: PlaybackState) {
      pending = state;
      if (timer) return; // already scheduled; it'll pick up the newest
      const since = Date.now() - lastSentAt;
      if (since >= PLAYBACK_EMIT_THROTTLE_MS) flushNow();
      else timer = setTimeout(flushNow, PLAYBACK_EMIT_THROTTLE_MS - since);
    },
    /** Immediate — for a discrete action whose exact position matters. */
    flush(state: PlaybackState) {
      pending = state;
      flushNow();
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

/**
 * Apply an absolute playback state. Seeks only when the gap is real: the
 * gateway echoes a SET_PLAYBACK back to the very screen that sent it, so
 * assigning currentTime unconditionally would fight the element's own
 * playback about once a second and stutter the picture.
 */
export function applyPlayback(video: HTMLVideoElement, state: PlaybackState) {
  if (Number.isFinite(state.time) && Math.abs(video.currentTime - state.time) > SEEK_TOLERANCE_SECONDS) {
    video.currentTime = state.time;
  }
  if (state.playing && video.paused) void video.play().catch(() => {});
  else if (!state.playing && !video.paused) video.pause();
}
