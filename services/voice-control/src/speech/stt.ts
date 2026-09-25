import type { Model } from "vosk-koffi";
import { VoskStream, type RecognizedWord } from "./vosk.js";

/**
 * Open-vocabulary command transcription (full Vosk model). Runs over the
 * same segment as the wake-word detector, so a one-breath "Travis, turn on
 * the lights" is split by word timestamps: only words that start after the
 * wake word ended belong to the command.
 */
export interface Transcript {
  text: string;
  /** Mean per-word confidence of the kept words (0 when empty). */
  confidence: number;
}

export class CommandTranscriber {
  private readonly stream: VoskStream;

  constructor(
    model: Model,
    sampleRate: number,
    private readonly wakeWord: string
  ) {
    this.stream = new VoskStream(model, sampleRate);
  }

  feed(frame: Int16Array): void {
    this.stream.feed(frame);
  }

  /** Close the segment; keep only words starting at/after `afterSec` (the wake word's end). */
  finish(afterSec = 0): Transcript {
    return transcriptAfter(this.stream.finish().words, afterSec, this.wakeWord);
  }

  reset(): void {
    this.stream.reset();
  }
}

export function transcriptAfter(words: RecognizedWord[], afterSec: number, wakeWord: string): Transcript {
  // Midpoint, not start: the two recognizers don't align word edges exactly,
  // and the open-vocabulary pass may split the wake word ("travel is") — a
  // fragment overlapping the wake word must not leak into the command.
  const kept = words.filter((w) => (w.start + w.end) / 2 >= afterSec && w.word !== "[unk]");
  // The open-vocabulary pass also hears the wake word itself; never let it
  // leak into the command text.
  const trimmed = afterSec > 0 && kept[0]?.word === wakeWord.toLowerCase() ? kept.slice(1) : kept;
  if (trimmed.length === 0) return { text: "", confidence: 0 };
  return {
    text: trimmed.map((w) => w.word).join(" "),
    confidence: trimmed.reduce((s, w) => s + w.conf, 0) / trimmed.length,
  };
}
