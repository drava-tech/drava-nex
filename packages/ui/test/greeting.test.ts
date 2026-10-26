import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GREET_SPEECH_RATE, pickGreetingVoice, speakGreeting, unmuteButtonVisible } from "../src/lib/greeting";

describe("unmute button", () => {
  it("is only a fallback for a blocked autoplay on the real TV", () => {
    expect(unmuteButtonVisible({ muted: true, preview: false, forceMuted: false })).toBe(true);
    expect(unmuteButtonVisible({ muted: false, preview: false, forceMuted: false })).toBe(false);
    expect(unmuteButtonVisible({ muted: true, preview: true, forceMuted: false })).toBe(false);
  });

  it("is never offered when the API says the welcome video is muted", () => {
    expect(unmuteButtonVisible({ muted: true, preview: false, forceMuted: true })).toBe(false);
  });
});

describe("voice choice", () => {
  const v = (lang: string, name = lang) => ({ lang, name });

  it("prefers en-IN, then any English, else nothing", () => {
    expect(pickGreetingVoice([v("en-US"), v("en-IN", "Heera"), v("en-GB")])?.name).toBe("Heera");
    expect(pickGreetingVoice([v("hi-IN"), v("en-GB", "Daniel"), v("en-US")])?.name).toBe("Daniel");
    expect(pickGreetingVoice([v("hi-IN"), v("fr-FR")])).toBeUndefined();
    expect(pickGreetingVoice([])).toBeUndefined();
  });

  it("copes with underscore locales and bare 'en'", () => {
    expect(pickGreetingVoice([v("en_IN", "Neerja")])?.name).toBe("Neerja");
    expect(pickGreetingVoice([v("en", "Generic")])?.name).toBe("Generic");
  });
});

describe("speakGreeting", () => {
  type Handler = () => void;
  let startBehaviour: "start" | "error" | "silent" = "start";
  beforeEach(() => {
    startBehaviour = "start";
  });
  const fakeSynth = (voices: () => { lang: string; name: string }[]) => {
    const handlers = new Set<Handler>();
    const spoken: unknown[] = [];
    const synth = {
      getVoices: vi.fn(() => voices()),
      cancel: vi.fn(),
      // a working engine fires onstart for the utterance it was given
      speak: vi.fn((u: unknown) => {
        spoken.push(u);
        if (startBehaviour === "start") queueMicrotask(() => (u as { onstart?: () => void }).onstart?.());
        if (startBehaviour === "error") queueMicrotask(() => (u as { onerror?: (e: unknown) => void }).onerror?.({ error: "synthesis-failed" }));
      }),
      addEventListener: vi.fn((_t: string, h: Handler) => void handlers.add(h)),
      removeEventListener: vi.fn((_t: string, h: Handler) => void handlers.delete(h)),
    };
    return { synth: synth as unknown as SpeechSynthesis, spoken, handlers, raw: synth };
  };
  const utterance = (text: string) => ({ text, rate: 0, pitch: 0, volume: 0, voice: null }) as unknown as SpeechSynthesisUtterance;

  afterEach(() => vi.useRealTimers());

  it("uses voices that are already loaded, cancels first, and logs the voice", async () => {
    const f = fakeSynth(() => [{ lang: "en-US", name: "Zira" }, { lang: "en-IN", name: "Heera" }]);
    const log = vi.fn();
    const result = await speakGreeting("Good evening, Priya. Welcome back.", { synth: f.synth, createUtterance: utterance, log });

    expect(result).toEqual({ spoke: true, voice: "Heera" });
    expect(f.raw.cancel).toHaveBeenCalledTimes(1);
    expect(f.raw.speak).toHaveBeenCalledTimes(1);
    const u = f.spoken[0] as { text: string; rate: number; voice: { name: string } };
    expect(u.text).toBe("Good evening, Priya. Welcome back.");
    expect(u.rate).toBe(GREET_SPEECH_RATE);
    expect(u.voice.name).toBe("Heera");
    expect(log).toHaveBeenCalledWith(expect.stringContaining('voice "Heera"'));
    expect(f.handlers.size).toBe(0);
  });

  it("waits for voiceschanged when the list starts empty", async () => {
    let loaded = false;
    const f = fakeSynth(() => (loaded ? [{ lang: "en-GB", name: "Daniel" }] : []));
    const pending = speakGreeting("Hello", { synth: f.synth, createUtterance: utterance, log: vi.fn() });
    await Promise.resolve();
    expect(f.raw.speak).not.toHaveBeenCalled();

    loaded = true;
    [...f.handlers].forEach((h) => h()); // browser fires voiceschanged
    await pending;

    expect((f.spoken[0] as { voice: { name: string } }).voice.name).toBe("Daniel");
    expect(f.handlers.size).toBe(0);
  });

  it("gives up after ~2 s and speaks with the default voice", async () => {
    vi.useFakeTimers();
    const f = fakeSynth(() => []);
    const log = vi.fn();
    const pending = speakGreeting("Hello", { synth: f.synth, createUtterance: utterance, log });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(f.raw.speak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(await pending).toEqual({ spoke: true }); // spoke, with the default voice

    expect((f.spoken[0] as { voice: unknown }).voice).toBeNull(); // none chosen
    expect(log).toHaveBeenCalledWith(expect.stringContaining("browser default voice"));
    expect(f.handlers.size).toBe(0);
  });

  it("reports and returns false where speech synthesis doesn't exist", async () => {
    const log = vi.fn();
    const original = Object.getOwnPropertyDescriptor(window, "speechSynthesis");
    delete (window as unknown as Record<string, unknown>)["speechSynthesis"];
    const result = await speakGreeting("Hello", { log });
    expect(result.spoke).toBe(false);
    expect(result.error).toContain("not available");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("not available"));
    if (original) Object.defineProperty(window, "speechSynthesis", original);
  });

  it("reports an engine error with its reason", async () => {
    startBehaviour = "error";
    const f = fakeSynth(() => [{ lang: "en-IN", name: "Heera" }]);
    const result = await speakGreeting("Hello", { synth: f.synth, createUtterance: utterance, log: vi.fn() });
    expect(result).toEqual({ spoke: false, error: "speech engine error: synthesis-failed" });
  });

  it("reports speech that never starts (blocked by the browser) after the start timeout", async () => {
    startBehaviour = "silent";
    vi.useFakeTimers();
    const f = fakeSynth(() => [{ lang: "en-IN", name: "Heera" }]);
    const pending = speakGreeting("Hello", { synth: f.synth, createUtterance: utterance, log: vi.fn(), startTimeoutMs: 4_000 });
    await vi.advanceTimersByTimeAsync(3_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const result = await pending;
    expect(result.spoke).toBe(false);
    expect(result.error).toContain("did not start");
  });

  it("uses the pinned voice when it is installed", async () => {
    const f = fakeSynth(() => [{ lang: "en-IN", name: "Heera" }, { lang: "en-GB", name: "Microsoft George" }]);
    const result = await speakGreeting("Hello", { synth: f.synth, createUtterance: utterance, log: vi.fn(), voiceName: "George" });
    expect(result).toEqual({ spoke: true, voice: "Microsoft George" });
  });

  it("falls back to en-IN when the pinned voice is missing, and says so", async () => {
    const f = fakeSynth(() => [{ lang: "en-IN", name: "Heera" }]);
    const log = vi.fn();
    const result = await speakGreeting("Hello", { synth: f.synth, createUtterance: utterance, log, voiceName: "Nope" });
    expect(result).toEqual({ spoke: true, voice: "Heera" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pinned voice "Nope" is not installed'));
  });
});

describe("pinned voice choice", () => {
  const v = (lang: string, name: string) => ({ lang, name });
  const voices = [v("en-IN", "Heera"), v("en-GB", "Microsoft George"), v("en-US", "Zira")];

  it("prefers an exact name, then a name that contains it, case-insensitively", () => {
    expect(pickGreetingVoice(voices, "zira")?.name).toBe("Zira");
    expect(pickGreetingVoice(voices, "george")?.name).toBe("Microsoft George");
  });

  it("ignores a blank pin and falls back to the usual order", () => {
    expect(pickGreetingVoice(voices, "  ")?.name).toBe("Heera");
    expect(pickGreetingVoice(voices, "missing")?.name).toBe("Heera");
  });
});
