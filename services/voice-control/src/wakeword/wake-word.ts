import type { Model } from "vosk-koffi";
import { VoskStream, type RecognizedWord } from "../speech/vosk.js";

/**
 * "Travis" detection with Vosk restricted to a tiny grammar: the wake word,
 * a few similar-sounding decoy words, and [unk]. Restricting the vocabulary
 * is what makes this a keyword spotter — the decoys give near-misses
 * ("travel", "trevor") somewhere to go other than "travis", and the word's
 * confidence must clear minConfidence. No model training involved.
 */
export interface WakeWordOptions {
  word: string;
  decoys: string[];
  minConfidence: number;
  /** Fire as soon as a partial result contains the word (lower latency). */
  acceptPartial: boolean;
}

export interface WakeDecision {
  detected: boolean;
  confidence: number;
  /** Seconds from segment start where the wake word ended (for splitting off the command). */
  wordEnd: number | null;
}

export class WakeWordDetector {
  private readonly stream: VoskStream;
  private partialHit = false;

  constructor(
    model: Model,
    sampleRate: number,
    private readonly options: WakeWordOptions
  ) {
    const word = options.word.toLowerCase();
    const grammar = [word, ...options.decoys.map((d) => d.toLowerCase()).filter((d) => d !== word), "[unk]"];
    this.stream = new VoskStream(model, sampleRate, grammar);
  }

  /** Feed a frame; true the first time a partial result contains the wake word. */
  feed(frame: Int16Array): boolean {
    this.stream.feed(frame);
    if (this.partialHit || !this.options.acceptPartial) return false;
    if (this.stream.partial().split(" ").includes(this.options.word.toLowerCase())) {
      this.partialHit = true;
      return true;
    }
    return false;
  }

  /** Close the segment and decide from the final, confidence-scored result. */
  finish(): WakeDecision {
    const { words } = this.stream.finish();
    this.partialHit = false;
    return decideWake(words, this.options.word, this.options.minConfidence);
  }

  reset(): void {
    this.stream.reset();
    this.partialHit = false;
  }
}

/**
 * Pure decision logic. The final result is authoritative: a partial hit that
 * the final result doesn't confirm at minConfidence is dropped — a false wake
 * (chime but no action) is better than executing on a misheard word.
 */
export function decideWake(words: RecognizedWord[], wakeWord: string, minConfidence: number): WakeDecision {
  const hits = words.filter((w) => w.word === wakeWord.toLowerCase());
  const best = hits.sort((a, b) => b.conf - a.conf)[0];
  if (best && best.conf >= minConfidence) return { detected: true, confidence: best.conf, wordEnd: best.end };
  return { detected: false, confidence: best?.conf ?? 0, wordEnd: null };
}
