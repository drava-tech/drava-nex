/**
 * Playback transport for the two time-based content kinds — a native <video>
 * (VideoRenderer) and a kiosk YouTube embed (HtmlRenderer) — sent over the
 * existing screen command channel. No gateway or @platform/types change is
 * needed: `command` is an untyped string there and there is no allowlist.
 *
 * The COMMAND NAMES below are this file's own; the state shape, timings,
 * emitter and apply they are built around moved to @platform/ui
 * (lib/playback-sync.ts) when the Portfolio template's film player started
 * needing the same machinery — that package cannot reach into apps/cms. They
 * are re-exported here, so every importer of this module is unchanged.
 *
 * Shaped like the PDF viewer's own protocol, for the same reasons:
 *
 *  - The CMS sends DELTAS (MEDIA_SEEK, MEDIA_TOGGLE_PLAY) for the taps, and
 *    one ABSOLUTE command (MEDIA_SEEK_TO) for a scrub-bar drag, which is
 *    inherently absolute — you drop the thumb at a position, not by an offset.
 *    MEDIA_SEEK_TO deliberately has NO SET_ prefix: it must never be cached
 *    and replayed, or re-pushing the content would re-seek it.
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
/** CMS → screen. Absolute position in seconds, for a scrub-bar drag. */
export const MEDIA_SEEK_TO = "MEDIA_SEEK_TO";
/**
 * CMS → screen. Set the paused state absolutely.
 *
 * Distinct from MEDIA_TOGGLE_PLAY, and the distinction is load-bearing. A
 * scrub has to pause the video and then restore what it was, and a TOGGLE
 * cannot express that: the CMS's idea of the play state is briefly stale by
 * design during a drag (PLAYBACK_SETTLE_MS below deliberately ignores inbound
 * updates), so a toggle sent to "pause for scrubbing" would start playback
 * instead. This is idempotent — sending it twice is a no-op, and it can never
 * invert the state. The toggle stays for the play/pause buttons, where the user
 * is asking for the opposite of whatever is happening.
 */
export const MEDIA_SET_PAUSED = "MEDIA_SET_PAUSED";
/** Screen → everyone. Absolute, cached by the gateway, replayed on re-push. */
export const SET_PLAYBACK = "SET_PLAYBACK";

/** Window events LiveScreenPlayer republishes these as, for the renderers. */
export const MEDIA_SEEK_EVENT = "media-seek";
export const MEDIA_SEEK_TO_EVENT = "media-seek-to";
export const MEDIA_TOGGLE_PLAY_EVENT = "media-toggle-play";
export const MEDIA_SET_PAUSED_EVENT = "media-set-paused";
export const MEDIA_SET_PLAYBACK_EVENT = "media-set-playback";

export interface MediaSeekPayload {
  /** Seconds to jump, signed. */
  delta: number;
}

export interface MediaSeekToPayload {
  /** Absolute seconds from the start. */
  time: number;
  /**
   * This seek is one frame of a drag in progress, not a destination.
   *
   * The renderer flushes a SET_PLAYBACK on every `seeked`, so at the ~8
   * seeks/second a live scrub produces that would be eight broadcasts a second
   * to every client of the screen. When this is set the renderer still seeks
   * but reports on the throttle instead; the final seek of a drag omits it and
   * flushes the authoritative position.
   */
  scrubbing?: boolean;
}

export interface MediaSetPausedPayload {
  paused: boolean;
}

/**
 * Re-exported from @platform/ui — see the note at the top of this file. These
 * are the pieces the Portfolio film player shares with the media path; keeping
 * them exported from here means every existing importer of this module (and
 * every future one reaching for "the playback protocol") still finds them in
 * one place.
 */
export {
  createPlaybackEmitter,
  applyPlayback,
  PLAYBACK_EMIT_THROTTLE_MS,
  PLAYBACK_SETTLE_MS,
  SCRUB_TRACK_INTERVAL_MS,
  SEEK_TOLERANCE_SECONDS,
  type PlaybackState,
} from "@platform/ui/playback-sync";
