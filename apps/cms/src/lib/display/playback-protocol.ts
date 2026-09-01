/**
 * Playback transport for the two time-based content kinds — a native <video>
 * (VideoRenderer) and a kiosk YouTube embed (HtmlRenderer) — sent over the
 * existing screen command channel. No gateway or @platform/types change is
 * needed: `command` is an untyped string there and there is no allowlist.
 *
 * Shaped like the PDF viewer's own protocol, for the same reasons:
 *
 *  - The CMS sends only DELTAS (MEDIA_SEEK, MEDIA_TOGGLE_PLAY). It has no
 *    reliable idea where the video actually is — SET_* fans out to the screen
 *    registry, never to CMS sockets — so it must not try to assert a position.
 *  - The authoritative screen answers with an ABSOLUTE SET_PLAYBACK. Absolute
 *    means a duplicate or late echo is a harmless no-op, where a replayed
 *    delta would seek twice.
 *  - The SET_ prefix is load-bearing, not cosmetic: the gateway caches any
 *    SET_* per screen AND per content and replays it when that content is
 *    pushed again (viewStateCache in apps/api/src/ws/gateway.ts). That single
 *    convention is the whole reason re-pushing a video from "Recently Opened"
 *    resumes where it left off, exactly as PDFs and decks now do.
 */

/** CMS → screen. Relative jump in seconds; negative rewinds. */
export const MEDIA_SEEK = "MEDIA_SEEK";
/** CMS → screen. Play if paused, pause if playing. */
export const MEDIA_TOGGLE_PLAY = "MEDIA_TOGGLE_PLAY";
/** Screen → everyone. Absolute, cached by the gateway, replayed on re-push. */
export const SET_PLAYBACK = "SET_PLAYBACK";

/** Window events LiveScreenPlayer republishes these as, for the renderers. */
export const MEDIA_SEEK_EVENT = "media-seek";
export const MEDIA_TOGGLE_PLAY_EVENT = "media-toggle-play";
export const MEDIA_SET_PLAYBACK_EVENT = "media-set-playback";

export interface MediaSeekPayload {
  /** Seconds to jump, signed. */
  delta: number;
}

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
