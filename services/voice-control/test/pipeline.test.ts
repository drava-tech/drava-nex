import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Pipeline, type Transcriber, type Voice, type WakeDetector } from "../src/pipeline.js";
import { VadSegmenter } from "../src/audio/vad.js";
import { loadRegistry } from "../src/commands/registry.js";
import { EventLog } from "../src/utils/logger.js";
import type { VoiceControlConfig } from "../src/config/config.js";

/**
 * Pipeline integration: real segmenter, registry, matcher, resolver and
 * executor; scripted wake/STT results, fake CMS and voice. Checks the whole
 * wake -> command -> CMS -> TTS flow and the required log events.
 */

const registry = loadRegistry(join(import.meta.dirname, "..", "config", "commands.json"));

const config = {
  stt: { modelPath: "", minConfidence: 0.55 },
  session: { wakeChime: true, nudgeAfterMs: 40, awakeTimeoutMs: 400, pendingAskMs: 5000 },
  matching: { fuzzy: true, fuzzyThreshold: 0.82, minMatchConfidence: 0.75 },
  defaults: { lightTarget: null, acTarget: null, screen: null },
} as unknown as VoiceControlConfig;

interface Segment {
  wake?: boolean;
  text: string;
  confidence?: number;
}

function setup(segments: Segment[], cmsReply = "Done it.") {
  const queue = [...segments];
  let current: Segment | undefined;
  const lines: string[] = [];

  const wake: WakeDetector = {
    feed: () => false,
    finish: () => {
      current = queue.shift();
      return current?.wake ? { detected: true, confidence: 0.95, wordEnd: 0.5 } : { detected: false, confidence: 0, wordEnd: null };
    },
    reset: () => {},
  };
  const stt: Transcriber = {
    feed: () => {},
    finish: () => {
      // In "listening" state wake.finish() isn't called, so take the next segment here.
      if (!current) current = queue.shift();
      const seg = current;
      current = undefined;
      return seg?.text ? { text: seg.text, confidence: seg.confidence ?? 0.9 } : { text: "", confidence: 0 };
    },
    reset: () => {
      current = undefined;
    },
  };
  const said: string[] = [];
  const voice: Voice = {
    say: vi.fn(async (text: string, onFirstAudio: () => void) => {
      onFirstAudio();
      said.push(text);
    }),
    chime: vi.fn(),
    prewarm: vi.fn(),
  };
  const cms = { send: vi.fn(async () => ({ message: cmsReply })), setSessionId: vi.fn() };
  const pipeline = new Pipeline({
    config,
    registry,
    vad: { isSpeech: (f: Int16Array) => f[0] !== 0, reset: () => {} },
    segmenter: new VadSegmenter({ frameMs: 30, speechStartMs: 30, speechEndMs: 60, preRollMs: 30, maxUtteranceMs: 3000 }),
    wake,
    stt,
    cms,
    voice,
    log: new EventLog((l) => lines.push(l)),
  });

  const utter = () => {
    for (let i = 0; i < 5; i++) pipeline.onFrame(new Int16Array(480).fill(1));
    for (let i = 0; i < 3; i++) pipeline.onFrame(new Int16Array(480));
  };
  const events = () => lines.map((l) => (l.startsWith("LATENCY") ? "LATENCY" : l.split(" ")[1]));
  return { pipeline, utter, cms, voice, said, lines, events };
}

const idle = (p: Pipeline) => vi.waitFor(() => expect(p.currentState).toBe("idle"));

describe("pipeline", () => {
  it("one breath: Travis + command -> CMS -> spoken reply, with every timing event", async () => {
    const t = setup([{ wake: true, text: "turn on the lights" }], "Turned on 4 lights.");
    t.utter();
    await idle(t.pipeline);

    expect(t.cms.send).toHaveBeenCalledWith({ endpoint: "lights", body: { action: "on" } });
    expect(t.said).toEqual(["Turned on 4 lights."]);
    expect(t.voice.chime).toHaveBeenCalledOnce();
    expect(t.voice.prewarm).toHaveBeenCalledOnce();
    expect(t.events()).toEqual([
      "SPEECH_STARTED",
      "SPEECH_ENDED",
      "WAKE_WORD_DETECTED",
      "STT_RESULT",
      "COMMAND_MATCHED",
      "CMS_REQUEST",
      "CMS_RESPONSE",
      "TTS_STARTED",
      "TTS_ENDED",
      "LATENCY",
    ]);
  });

  it('"Travis", pause, then the command in the next utterance', async () => {
    const t = setup([{ wake: true, text: "" }, { text: "pause screen two" }]);
    t.utter();
    expect(t.pipeline.currentState).toBe("listening");
    t.utter();
    await idle(t.pipeline);
    expect(t.cms.send).toHaveBeenCalledWith({ endpoint: "screen", body: { action: "pause", screen: "screen 2" } });
  });

  it("Travis alone + silence -> nudge; the answer needs no second Travis", async () => {
    const t = setup([{ wake: true, text: "" }, { text: "lock the door" }]);
    t.utter();
    await vi.waitFor(() => expect(t.said).toEqual(["Yes? What would you like?"]));
    await vi.waitFor(() => expect(t.pipeline.currentState).toBe("listening"));
    t.utter();
    await idle(t.pipeline);
    expect(t.cms.send).toHaveBeenCalledWith({ endpoint: "door", body: { action: "lock" } });
  });

  it("gives up after awakeTimeoutMs with no command", async () => {
    const t = setup([{ wake: true, text: "" }]);
    t.utter();
    await vi.waitFor(() => expect(t.lines.some((l) => l.includes("no_command_before_timeout"))).toBe(true), { timeout: 2000 });
    expect(t.pipeline.currentState).toBe("idle");
    expect(t.cms.send).not.toHaveBeenCalled();
  });

  it("ignores speech without the wake word", async () => {
    const t = setup([{ text: "turn on the lights" }]);
    t.utter();
    expect(t.pipeline.currentState).toBe("idle");
    expect(t.cms.send).not.toHaveBeenCalled();
    expect(t.events()).not.toContain("WAKE_WORD_DETECTED");
  });

  it("does not execute low-confidence speech or unknown commands", async () => {
    const low = setup([{ wake: true, text: "turn on the lights", confidence: 0.3 }]);
    low.utter();
    await idle(low.pipeline);
    expect(low.cms.send).not.toHaveBeenCalled();
    expect(low.said).toEqual(["Sorry, I didn't catch that."]);

    const unknown = setup([{ wake: true, text: "what is the weather" }]);
    unknown.utter();
    await idle(unknown.pipeline);
    expect(unknown.cms.send).not.toHaveBeenCalled();
    expect(unknown.said).toEqual(["Sorry, I don't know that command."]);
  });

  it("asks for a missing name, and 'Travis, <name>' completes the command", async () => {
    const t = setup([
      { wake: true, text: "pause" },
      { wake: true, text: "lobby screen" },
    ]);
    t.utter();
    await idle(t.pipeline);
    expect(t.said).toEqual(["Which screen is playing it? Say Travis, then the name."]);
    expect(t.cms.send).not.toHaveBeenCalled();

    t.utter();
    await idle(t.pipeline);
    expect(t.cms.send).toHaveBeenCalledWith({ endpoint: "screen", body: { action: "pause", screen: "lobby screen" } });
  });

  it("ignores the mic while busy", async () => {
    const t = setup([{ wake: true, text: "turn on the lights" }]);
    let release!: () => void;
    t.cms.send.mockImplementationOnce(
      () => new Promise((r) => (release = () => r({ message: "ok" })))
    );
    t.utter();
    await vi.waitFor(() => expect(t.cms.send).toHaveBeenCalled());
    expect(t.pipeline.currentState).toBe("busy");
    t.utter(); // would be a second command if not ignored
    release();
    await idle(t.pipeline);
    expect(t.cms.send).toHaveBeenCalledTimes(1);
  });
});

describe("shutdown", () => {
  it('"Travis, shut down" says goodbye, then shuts down', async () => {
    const onShutdown = vi.fn();
    const t = setup([{ wake: true, text: "shut down" }]);
    (t.pipeline as unknown as { deps: { onShutdown: () => void } }).deps.onShutdown = onShutdown;
    t.utter();
    await vi.waitFor(() => expect(onShutdown).toHaveBeenCalledOnce());
    expect(t.said).toEqual(["Shutting down. Goodbye."]);
    expect(t.cms.send).not.toHaveBeenCalled();
  });

  it("other commands never shut down", async () => {
    const onShutdown = vi.fn();
    const t = setup([{ wake: true, text: "lock the door" }]);
    (t.pipeline as unknown as { deps: { onShutdown: () => void } }).deps.onShutdown = onShutdown;
    t.utter();
    await idle(t.pipeline);
    expect(onShutdown).not.toHaveBeenCalled();
  });
});
