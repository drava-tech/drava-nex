"use client";

import { useEffect, useRef, useState } from "react";
import type { WelcomeContent } from "./content";
import { unmuteButtonVisible } from "../../lib/greeting";

const TYPE_SPEED_MS = 95;
const START_DELAY_MS = 900;
const SPEECH_RATE = 0.65;
const SPEECH_PAUSE_MS = 500;

/** Prefers an English (India) voice (en-IN) if the browser/OS has one
 * installed; falls back to a name match, then the browser default. Which
 * voices exist depends entirely on the TV's browser/OS — there is no
 * universal "Indian voice" every platform ships. */
function pickIndianEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  return (
    voices.find((v) => v.lang.toLowerCase() === "en-in") ||
    voices.find((v) => v.lang.toLowerCase().startsWith("en-in")) ||
    voices.find((v) => /india/i.test(v.name))
  );
}

/** Reveals `text` one character at a time (typewriter effect), starting
 * `startDelayMs` after mount. Restarts whenever `text` changes. */
function useTypewriter(text: string, startDelayMs: number): { shown: string; done: boolean } {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(0);
    if (!text) return;
    let i = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1;
        setCount(i);
        if (i >= text.length && interval) clearInterval(interval);
      }, TYPE_SPEED_MS);
    }, startDelayMs);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [text, startDelayMs]);

  return { shown: text.slice(0, count), done: count >= text.length };
}

/** Full-screen greeting: headline + tagline over a dark gradient, with an
 * optional video beneath it that plays once and holds on its last frame
 * (no loop) once triggered. Title/subtitle type out letter by
 * letter rather than appearing all at once. `speak` (opt-in, off by default)
 * reads the text aloud via the browser's speech synthesis — callers must
 * gate this to the real TV only, never a CMS preview/mirror. */
export function WelcomeRenderer({
  content,
  speak = false,
  preview = false,
}: {
  content?: WelcomeContent;
  speak?: boolean;
  /** True for any CMS-side embed of this screen (editor live preview, Screens
   * control page, Live Control popup, ...) — audio must only ever come out of
   * the real TV, same contract as VideoRenderer.tsx's `preview` prop. */
  preview?: boolean;
}) {
  const title = content?.title || "Welcome to Tusker Digital Experience Center";
  const subtitle = content?.subtitle;
  const videoUrl = content?.videoUrl;
  // API-set (never authored): muted = silent and not unmutable here; narrate
  // false = the GREET voice line owns the audio. Both unset = today's behaviour.
  const forceMuted = content?.muted === true;
  const narrate = content?.narrate !== false;

  const typedTitle = useTypewriter(title, START_DELAY_MS);
  const subtitleDelay = START_DELAY_MS + title.length * TYPE_SPEED_MS + 250;
  const typedSubtitle = useTypewriter(subtitle ?? "", subtitleDelay);

  const videoRef = useRef<HTMLVideoElement>(null);
  // Default to unmuted: the kiosk's WebView2 host launches with
  // --autoplay-policy=no-user-gesture-required (tools/main-screen-kiosk/
  // MainWindow.xaml.cs), so the real TV can autoplay with sound with no
  // gesture needed. The `autoPlay` attribute can't surface a blocked-playback
  // promise rejection, though, so the effect below calls play() explicitly —
  // on any viewer WITHOUT that flag (a plain browser previewing this
  // experience in the CMS, say), the rejection flips this to muted and the
  // tap-to-unmute button below becomes the fallback. Same contract as
  // VideoRenderer.tsx, minus the unattended-kiosk assumption — this template
  // keeps the button since a muted fallback here does have a real click path.
  const [muted, setMuted] = useState(preview || forceMuted);
  // A videoUrl pointing at a deleted/missing asset (e.g. removed from the
  // Media Library after being saved here) would otherwise fail to load
  // silently — the <video> element just sits there black with nothing on
  // screen. Falls back to the headline/subtitle branch below instead.
  // Reset whenever the url itself changes, so a fresh, valid video gets a
  // clean retry rather than staying stuck on a previous failure.
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => {
    setVideoFailed(false);
    setMuted(preview || forceMuted);
  }, [videoUrl, preview, forceMuted]);

  useEffect(() => {
    // A CMS-side embed never attempts unmuted playback at all — skipping
    // straight past the play()/catch dance below means it also never trips
    // the fallback-to-muted state, so there's nothing for the tap-to-unmute
    // button to react to and it correctly never renders in preview.
    if (preview) return;
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => {
      if (!video.muted) {
        video.muted = true;
        setMuted(true);
        video.play().catch(() => {});
      }
    });
  }, [videoUrl, preview]);

  const handleUnmute = () => {
    if (preview || forceMuted) return;
    setMuted(false);
    // A muted-autoplaying video can visually stall right when unmuted on some
    // browsers/TV webviews — nudge it to keep playing under the same click
    // that just granted the gesture, same as VideoRenderer's assumption that
    // play() succeeds once there's real user interaction behind it.
    videoRef.current?.play().catch(() => {});
  };

  useEffect(() => {
    // A full-screen video already carries its own audio — narrating the
    // headline over it would just talk over the video's own sound. A failed
    // video falls back to the text branch below, so it should speak same as
    // if no video had been set at all.
    const showingVideo = videoUrl && !videoFailed;
    if (!speak || !narrate || showingVideo || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    let cancelled = false;
    let spoken = false;

    const speakNow = () => {
      if (cancelled || spoken) return;
      spoken = true;
      const voice = pickIndianEnglishVoice(synth.getVoices());

      const makeUtterance = (t: string) => {
        const u = new SpeechSynthesisUtterance(t);
        u.rate = SPEECH_RATE;
        u.volume = 1;
        u.pitch = 1;
        if (voice) u.voice = voice;
        return u;
      };

      // Two separate utterances with a deliberate pause between them, rather
      // than one run-on sentence — reads far more clearly than jamming
      // headline + tagline together with just a period.
      const titleUtterance = makeUtterance(title);
      if (subtitle) {
        titleUtterance.onend = () => {
          if (cancelled) return;
          setTimeout(() => {
            if (!cancelled) synth.speak(makeUtterance(subtitle));
          }, SPEECH_PAUSE_MS);
        };
      }
      synth.speak(titleUtterance);
    };

    const timer = setTimeout(() => {
      // Chrome loads voices asynchronously — on first use getVoices() can
      // still be empty, so wait for voiceschanged (with a timed fallback in
      // case it never fires) before picking a voice and speaking.
      if (synth.getVoices().length > 0) {
        speakNow();
        return;
      }
      synth.addEventListener("voiceschanged", speakNow);
      setTimeout(speakNow, 500);
    }, START_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      synth.removeEventListener("voiceschanged", speakNow);
      synth.cancel();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speak, narrate, title, subtitle, videoFailed]);

  // A video takes over the whole screen on its own — no headline, subtitle,
  // gradient, or padding around it, just the video edge-to-edge.
  if (videoUrl && !videoFailed) {
    return (
      <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#000", position: "relative" }}>
        <video
          key={videoUrl}
          ref={videoRef}
          src={videoUrl}
          // No `autoPlay` attribute: the effect above already calls play()
          // explicitly. Having BOTH triggers the video's own autoplay start
          // *and* our imperative play() call as two separate play requests —
          // the browser treats the second as interrupting the first, which is
          // what caused the ~1s-in stutter (silent and invisible while the
          // video was always muted; audible now that it plays with sound).
          muted={muted}
          preload="auto"
          playsInline
          onError={() => setVideoFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
        {unmuteButtonVisible({ muted, preview, forceMuted }) && (
          <button
            onClick={handleUnmute}
            style={{
              position: "absolute",
              right: "3vw",
              bottom: "3vh",
              width: "3.4vw",
              height: "3.4vw",
              minWidth: "44px",
              minHeight: "44px",
              borderRadius: "50%",
              background: "rgba(0,0,0,0.45)",
              border: "1px solid rgba(255,255,255,0.4)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
            }}
            aria-label="Turn on sound"
            title="Turn on sound"
          >
            <svg width="45%" height="45%" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <path d="M11 5 6 9H2v6h4l5 4V5Z" fill="#fff" stroke="none" />
              <line x1="23" y1="9" x2="17" y2="15" strokeLinecap="round" />
              <line x1="17" y1="9" x2="23" y2="15" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "4vh",
        padding: "6vh 6vw",
        boxSizing: "border-box",
        background:
          "radial-gradient(circle at 50% 0%, #1c2733 0%, #0a0e14 55%, #000000 100%)",
        color: "#fff",
        fontFamily: "var(--font-sans, Geist, system-ui, sans-serif)",
        textAlign: "center",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.6vh" }}>
        <span
          style={{
            fontSize: "1.3vw",
            fontWeight: 600,
            letterSpacing: "0.5em",
            textTransform: "uppercase",
            color: "rgba(245, 190, 90, 0.85)",
          }}
        >
          Tusker Digital
        </span>
        <h1
          style={{
            fontSize: "6vw",
            fontWeight: 800,
            lineHeight: 1.1,
            margin: 0,
            maxWidth: "80vw",
            letterSpacing: "-0.01em",
          }}
        >
          {typedTitle.shown}
          {!typedTitle.done && <span className="welcome-caret" />}
        </h1>
        {subtitle ? (
          <p
            style={{
              fontSize: "1.6vw",
              fontWeight: 400,
              margin: 0,
              maxWidth: "60vw",
              color: "rgba(255,255,255,0.6)",
            }}
          >
            {typedSubtitle.shown}
            {typedTitle.done && !typedSubtitle.done && <span className="welcome-caret" />}
          </p>
        ) : null}
      </div>
      <style>{`
        .welcome-caret {
          display: inline-block;
          width: 0.05em;
          height: 0.9em;
          margin-left: 0.06em;
          background: currentColor;
          vertical-align: -0.05em;
          animation: welcome-caret-blink 0.8s steps(1) infinite;
        }
        @keyframes welcome-caret-blink {
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
