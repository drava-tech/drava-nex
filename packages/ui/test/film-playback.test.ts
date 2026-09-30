import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  SET_VIDEO_PLAYBACK,
  VIDEO_PLAYBACK_EVENT,
  useFilmPlayback,
  type FilmPlayback,
} from "../src/templates/portfolio/components/use-film-playback";
import { PortfolioScreenProvider } from "../src/templates/portfolio/screen-context";
import { dispatchReplayableEvent } from "../src/lib/replayable-window-event";

/**
 * The film transport's wire contract, which is the half of it no amount of
 * clicking around one screen can check: what a client broadcasts, what it
 * applies, and what it must ignore.
 *
 * jsdom ships HTMLMediaElement as a shell — play() throws "not implemented",
 * currentTime never moves — so the element is given just enough behaviour to be
 * a video: play/pause flip `paused` and raise their events, and assigning
 * currentTime raises `seeked`. That is exactly the surface the hook drives, so
 * the test exercises the real code path rather than a mock of it.
 */
beforeAll(() => {
  const proto = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(proto, "play", {
    configurable: true,
    value(this: HTMLMediaElement & { _paused?: boolean }) {
      this._paused = false;
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    },
  });
  Object.defineProperty(proto, "pause", {
    configurable: true,
    value(this: HTMLMediaElement & { _paused?: boolean }) {
      this._paused = true;
      this.dispatchEvent(new Event("pause"));
    },
  });
  Object.defineProperty(proto, "paused", {
    configurable: true,
    get(this: { _paused?: boolean }) {
      return this._paused !== false;
    },
  });
  Object.defineProperty(proto, "currentTime", {
    configurable: true,
    get(this: { _time?: number }) {
      return this._time ?? 0;
    },
    set(this: HTMLMediaElement & { _time?: number }, value: number) {
      this._time = value;
      this.dispatchEvent(new Event("seeked"));
    },
  });
  Object.defineProperty(proto, "duration", {
    configurable: true,
    get(this: { _duration?: number }) {
      return this._duration ?? 120;
    },
  });
});

const FILM = "https://media.example/one.mp4";
const OTHER_FILM = "https://media.example/two.mp4";

let container: HTMLElement;
let root: Root;
/** The hook's return value from the latest render. */
let playback: FilmPlayback;
/** Every SET_VIDEO_PLAYBACK this client broadcast, in order. */
let sent: { command: string; value: { src: string; time: number; playing: boolean } }[];

function Probe({ src, withVideo = true }: { src: string; withVideo?: boolean }) {
  playback = useFilmPlayback(src);
  // `withVideo` reproduces the films page, which renders its grid — and no
  // <video> at all — while already naming the film it would play.
  return withVideo ? createElement("video", { ref: playback.videoRef }) : null;
}

function mount(node: ReactElement) {
  act(() => {
    root.render(node);
  });
}

function video(): HTMLVideoElement {
  return container.querySelector("video") as HTMLVideoElement;
}

const onControl = (e: Event) => {
  sent.push((e as CustomEvent).detail);
};

beforeEach(() => {
  // The replay buffer is module state shared by every consumer — a position
  // left behind by one test would be applied on mount in the next.
  dispatchReplayableEvent(VIDEO_PLAYBACK_EVENT, null);
  sent = [];
  window.addEventListener("screen-control", onControl);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  window.removeEventListener("screen-control", onControl);
  act(() => root.unmount());
  container.remove();
});

describe("useFilmPlayback", () => {
  it("broadcasts an absolute state when the transport is used", () => {
    mount(createElement(Probe, { src: FILM }));
    // The autoplay effect already played it; start from a known, quiet state.
    act(() => playback.togglePlay());
    sent = [];

    act(() => playback.togglePlay());

    const last = sent.at(-1);
    expect(last?.command).toBe(SET_VIDEO_PLAYBACK);
    // Absolute, and carrying its source — a duplicate or late echo of this has
    // to be a harmless no-op, and it must never be applied to another film.
    expect(last?.value.src).toBe(FILM);
    expect(last?.value.playing).toBe(true);
    expect(typeof last?.value.time).toBe("number");
  });

  it("seeks the element and reports where it landed", () => {
    mount(createElement(Probe, { src: FILM }));
    sent = [];

    act(() => playback.seekBy(30));

    expect(video().currentTime).toBe(30);
    expect(sent.at(-1)?.value.time).toBe(30);
  });

  it("applies an inbound position for the film it is showing", () => {
    mount(createElement(Probe, { src: FILM }));

    act(() => {
      dispatchReplayableEvent(VIDEO_PLAYBACK_EVENT, { src: FILM, time: 42, playing: true });
    });

    expect(video().currentTime).toBe(42);
  });

  it("ignores a position belonging to a different film", () => {
    mount(createElement(Probe, { src: FILM }));
    act(() => playback.seekBy(10));

    act(() => {
      dispatchReplayableEvent(VIDEO_PLAYBACK_EVENT, { src: OTHER_FILM, time: 99, playing: true });
    });

    // The gateway's replay buffer is keyed by command name, not by content, so
    // this is the guard that stops a stale position painting the wrong film.
    expect(video().currentTime).toBe(10);
  });

  it("does not re-seek for drift inside the tolerance", () => {
    mount(createElement(Probe, { src: FILM }));
    act(() => playback.seekBy(50));

    act(() => {
      dispatchReplayableEvent(VIDEO_PLAYBACK_EVENT, { src: FILM, time: 50.5, playing: true });
    });

    // The gateway echoes every report back to the sender. Applying one this
    // close would fight the element's own playback about once a second.
    expect(video().currentTime).toBe(50);
  });

  it("resumes from the replayed position when the element mounts late", () => {
    // What a CMS mirror joining mid-film gets: the cached state arrives before
    // any <video> of this film exists.
    dispatchReplayableEvent(VIDEO_PLAYBACK_EVENT, { src: FILM, time: 77, playing: true });

    mount(createElement(Probe, { src: FILM }));
    act(() => {
      video().dispatchEvent(new Event("loadedmetadata"));
    });

    expect(video().currentTime).toBe(77);
  });

  it("binds a <video> that arrives under an unchanged src", () => {
    // The films page keeps `index` at 0 behind its grid, so opening the FIRST
    // film mounts an element without changing `src`. Anything that waited on a
    // src change to find the element left that one film untouchable — a dead
    // scrub bar and a button that never tracked — while every other film, which
    // does change `src`, worked.
    mount(createElement(Probe, { src: FILM, withVideo: false }));
    mount(createElement(Probe, { src: FILM, withVideo: true }));

    // Listeners are on it: the element's own events reach the bar...
    act(() => {
      video().dispatchEvent(new Event("loadedmetadata"));
    });
    expect(playback.duration).toBe(120);
    expect(playback.playing).toBe(true);

    // ...and the transport drives it and reports.
    sent = [];
    act(() => playback.seekBy(25));
    expect(video().currentTime).toBe(25);
    expect(sent.at(-1)?.value.time).toBe(25);
  });

  it("keeps a mirror off the position drip but lets it steer a scrub", () => {
    // Fake timers because both halves of this ride the emitter's throttle: it
    // holds the newest value and sends it on a trailing timer, so "nothing was
    // sent" is only true once that timer has been allowed to fire.
    vi.useFakeTimers();
    try {
      mount(
        createElement(
          PortfolioScreenProvider,
          { mirror: true },
          createElement(Probe, { src: FILM })
        )
      );
      sent = [];

      // The steady report a playing film makes: a mirror owns no timeline, so
      // it must stay quiet or two clients would race to be cached.
      act(() => {
        video().dispatchEvent(new Event("timeupdate"));
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(sent).toHaveLength(0);

      // A drag is the operator steering, and has to reach the panel.
      act(() => {
        playback.beginScrub();
        playback.scrubTo(64);
      });
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(sent.some((m) => m.value.time === 64)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores playback after a scrub only if it was playing", () => {
    mount(createElement(Probe, { src: FILM }));
    act(() => {
      playback.beginScrub();
    });
    // Held still for the drag, so the frame being aimed at stops moving.
    expect(video().paused).toBe(true);

    act(() => playback.endScrub(12));

    expect(video().currentTime).toBe(12);
    expect(video().paused).toBe(false);
  });
});
