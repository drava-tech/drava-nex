/**
 * Player-side pieces of "greet on arrival". The API decides everything (who to
 * greet, whether to speak, whether the welcome video is muted); this file only
 * carries it out on the TV. All of it takes its collaborators as parameters so
 * it can be unit-tested (test/greeting.test.ts).
 */

// ─── Welcome video controls ──────────────────────────────────────────────────

/**
 * The "Turn on sound" button only exists as the fallback for a browser that
 * blocked unmuted autoplay. When the API says the welcome video is muted
 * (forceMuted) it must not be offered at all: unmuting would put the video's
 * audio back under the greeting.
 */
export function unmuteButtonVisible(state: { muted: boolean; preview: boolean; forceMuted: boolean }): boolean {
  return state.muted && !state.preview && !state.forceMuted;
}

// ─── Speaking ────────────────────────────────────────────────────────────────

export const GREET_VOICE_TIMEOUT_MS = 2_000;
export const GREET_SPEECH_RATE = 0.85;

export interface VoiceLike {
  lang: string;
  name: string;
}

/**
 * The pinned voice if one is configured and installed (exact name first, then a name that
 * contains it), else an English (India) voice, then any English voice, else none (browser default).
 */
export function pickGreetingVoice<T extends VoiceLike>(voices: readonly T[], preferredName?: string): T | undefined {
  const lang = (v: T) => v.lang.toLowerCase().replace("_", "-");
  const wanted = preferredName?.trim().toLowerCase();
  if (wanted) {
    const pinned =
      voices.find((v) => v.name.toLowerCase() === wanted) ?? voices.find((v) => v.name.toLowerCase().includes(wanted));
    if (pinned) return pinned;
  }
  return voices.find((v) => lang(v).startsWith("en-in")) ?? voices.find((v) => lang(v) === "en" || lang(v).startsWith("en-"));
}

/**
 * Chrome fills getVoices() asynchronously: ask first, and only if it is empty
 * wait for `voiceschanged` — but never longer than timeoutMs, so a TV with no
 * voices at all still speaks (with the default) instead of hanging.
 */
function voicesReady(synth: SpeechSynthesis, timeoutMs: number): Promise<SpeechSynthesisVoice[]> {
  const now = synth.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      synth.removeEventListener("voiceschanged", finish);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(finish, timeoutMs);
    synth.addEventListener("voiceschanged", finish);
  });
}

/** How long to wait for the engine to actually start before reporting that it did not. */
export const GREET_START_TIMEOUT_MS = 4_000;

export interface SpeakOptions {
  synth?: SpeechSynthesis;
  createUtterance?: (text: string) => SpeechSynthesisUtterance;
  timeoutMs?: number;
  /** GREETING_VOICE_NAME, sent by the API. */
  voiceName?: string;
  startTimeoutMs?: number;
  log?: (message: string) => void;
}

/** What happened, in the shape the TV reports back to the API (GREET_ACK). */
export interface GreetResult {
  spoke: boolean;
  /** The voice that was used, when it spoke with a named voice. */
  voice?: string;
  /** Why it did not speak. */
  error?: string;
}

/**
 * Speak one greeting line and report what really happened: it resolves when the
 * engine STARTS speaking, errors, or (browsers can silently block speech without
 * a user gesture) does neither within startTimeoutMs.
 */
export async function speakGreeting(text: string, opts: SpeakOptions = {}): Promise<GreetResult> {
  const log = opts.log ?? ((m: string) => console.info(m));
  const synth = opts.synth ?? (typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : undefined);
  if (!synth) {
    log("[greet] cannot speak: speechSynthesis is not available in this browser");
    return { spoke: false, error: "speechSynthesis is not available in this browser" };
  }

  const voices = await voicesReady(synth, opts.timeoutMs ?? GREET_VOICE_TIMEOUT_MS);
  const voice = pickGreetingVoice(voices, opts.voiceName);
  if (opts.voiceName && voice && !voice.name.toLowerCase().includes(opts.voiceName.trim().toLowerCase())) {
    log(`[greet] pinned voice "${opts.voiceName}" is not installed — using "${voice.name}" instead`);
  }

  const utterance = (opts.createUtterance ?? ((t: string) => new SpeechSynthesisUtterance(t)))(text);
  utterance.rate = GREET_SPEECH_RATE;
  utterance.pitch = 1;
  utterance.volume = 1;
  if (voice) utterance.voice = voice;

  const outcome = new Promise<GreetResult>((resolve) => {
    const timer = setTimeout(
      () => resolve({ spoke: false, error: "speech did not start (blocked by the browser, or no working voice)" }),
      opts.startTimeoutMs ?? GREET_START_TIMEOUT_MS
    );
    utterance.onstart = () => {
      clearTimeout(timer);
      resolve({ spoke: true, ...(voice ? { voice: voice.name } : {}) });
    };
    utterance.onerror = (event: SpeechSynthesisErrorEvent | Event) => {
      clearTimeout(timer);
      const reason = (event as SpeechSynthesisErrorEvent).error;
      resolve({ spoke: false, error: `speech engine error${reason ? `: ${reason}` : ""}` });
    };
  });

  synth.cancel();
  synth.speak(utterance);
  log(
    voice
      ? `[greet] speaking with voice "${voice.name}" (${voice.lang})`
      : `[greet] speaking with the browser default voice (no English voice among ${voices.length})`
  );
  return outcome;
}
