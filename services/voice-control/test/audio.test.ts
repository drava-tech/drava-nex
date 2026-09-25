import { describe, expect, it } from "vitest";
import { VadSegmenter, WebRtcVad, type SegmentEvent } from "../src/audio/vad.js";
import { pickDevice } from "../src/audio/devices.js";
import { applyGain, wakeChime } from "../src/audio/speaker.js";

const FRAME = 480;
const frame = (v = 0) => new Int16Array(FRAME).fill(v);

function run(seg: VadSegmenter, pattern: string): SegmentEvent[] {
  // "s" = speech frame, "." = silence frame
  return [...pattern].flatMap((c, i) => seg.push(frame(i), c === "s"));
}

describe("VadSegmenter", () => {
  const opts = { frameMs: 30, speechStartMs: 90, speechEndMs: 150, preRollMs: 60, maxUtteranceMs: 600 };

  it("opens after speechStartMs of speech, with pre-roll, and closes after speechEndMs of silence", () => {
    const seg = new VadSegmenter(opts);
    const events = run(seg, "....sss" + "ss" + ".....");
    const start = events.find((e) => e.type === "start");
    expect(start && start.type === "start" && start.frames.length).toBe(5); // 2 pre-roll + 3 onset frames
    expect(events.filter((e) => e.type === "frame")).toHaveLength(7);
    expect(events.at(-1)).toEqual({ type: "end", reason: "silence" });
    expect(seg.active).toBe(false);
  });

  it("ignores speech blips shorter than speechStartMs", () => {
    const seg = new VadSegmenter(opts);
    expect(run(seg, "ss..s.ss..")).toEqual([]);
  });

  it("brief pauses inside speech don't end the segment", () => {
    const seg = new VadSegmenter(opts);
    const events = run(seg, "sss..ss..ss");
    expect(events.some((e) => e.type === "end")).toBe(false);
  });

  it("force-closes at maxUtteranceMs", () => {
    const seg = new VadSegmenter(opts);
    const events = run(seg, "s".repeat(40));
    expect(events.find((e) => e.type === "end")).toEqual({ type: "end", reason: "max_length" });
  });
});

describe("WebRtcVad (libfvad WASM)", () => {
  it("classifies silence as non-speech and a voiced tone burst as speech", async () => {
    const vad = await WebRtcVad.create(16000, FRAME, 3);
    expect(vad.isSpeech(frame(0))).toBe(false);
    // Harmonic-rich 150 Hz "vowel" — WebRTC VAD keys on speech-band energy.
    let speech = false;
    for (let f = 0; f < 20; f++) {
      const pcm = new Int16Array(FRAME);
      for (let i = 0; i < FRAME; i++) {
        const t = (f * FRAME + i) / 16000;
        let s = 0;
        for (let h = 1; h <= 12; h++) s += Math.sin(2 * Math.PI * 150 * h * t) / h;
        pcm[i] = Math.round(s * 6000);
      }
      speech = vad.isSpeech(pcm) || speech;
    }
    expect(speech).toBe(true);
  });

  it("rejects frames of the wrong size", async () => {
    const vad = await WebRtcVad.create(16000, FRAME, 3);
    expect(() => vad.isSpeech(new Int16Array(100))).toThrow(/expects 480/);
  });
});

describe("devices", () => {
  const inputs = ["Microphone Array (Intel® Smart Sound Technology)", "Headset (Smiledrive)"];

  it("prefers the first matching substring, case-insensitively", () => {
    expect(pickDevice(inputs, ["headset (smiledrive)", "Microphone Array (Intel"])).toEqual({ index: 1, name: inputs[1] });
  });

  it("falls back down the list, then to the system default", () => {
    expect(pickDevice(inputs.slice(0, 1), ["Headset (Smiledrive)", "Microphone Array (Intel"]).index).toBe(0);
    expect(pickDevice(inputs, ["nope"]).index).toBe(-1);
  });
});

describe("speaker helpers", () => {
  it("gain clips instead of wrapping", () => {
    expect([...applyGain(new Int16Array([20000, -20000, 100]), 2)]).toEqual([32767, -32768, 200]);
  });

  it("chime is short and within range", () => {
    const pcm = wakeChime(16000);
    expect(pcm.length).toBe(Math.round(16000 * 0.07) + Math.round(16000 * 0.11));
    expect(Math.max(...pcm)).toBeLessThanOrEqual(9000);
  });
});
