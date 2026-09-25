import { describe, expect, it } from "vitest";
import { decideWake } from "../src/wakeword/wake-word.js";
import { transcriptAfter } from "../src/speech/stt.js";

const w = (word: string, start: number, end: number, conf = 1) => ({ word, start, end, conf });

describe("decideWake", () => {
  it("accepts the wake word at or above minConfidence", () => {
    expect(decideWake([w("[unk]", 0, 0.3), w("travis", 0.4, 0.8, 0.93)], "travis", 0.8)).toEqual({
      detected: true,
      confidence: 0.93,
      wordEnd: 0.8,
    });
  });

  it("rejects a low-confidence hit and decoys", () => {
    expect(decideWake([w("travis", 0, 0.4, 0.5)], "travis", 0.8).detected).toBe(false);
    expect(decideWake([w("travel", 0, 0.4)], "travis", 0.8).detected).toBe(false);
  });
});

describe("transcriptAfter", () => {
  const words = [w("travis", 0.1, 0.6), w("turn", 0.7, 0.9, 0.9), w("on", 0.9, 1.0, 0.8), w("lights", 1.1, 1.5, 1)];

  it("keeps only the words after the wake word", () => {
    expect(transcriptAfter(words, 0.6, "travis")).toEqual({ text: "turn on lights", confidence: 0.9 });
  });

  it("drops a fragment overlapping the wake word (misheard 'travel is')", () => {
    const misheard = [w("travel", 0.1, 0.45), w("is", 0.45, 0.62), w("stop", 0.8, 1.1)];
    expect(transcriptAfter(misheard, 0.6, "travis").text).toBe("stop");
  });

  it("empty when only the wake word was said", () => {
    expect(transcriptAfter([w("travis", 0.1, 0.6)], 0.6, "travis")).toEqual({ text: "", confidence: 0 });
  });
});
