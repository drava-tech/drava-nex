import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import type * as VoskTypes from "vosk-koffi";

/**
 * Thin wrapper over vosk-koffi (Vosk via koffi FFI — the official `vosk`
 * package depends on ffi-napi, which doesn't build on current Node). One
 * Model is loaded once and shared by the wake-word and command recognizers.
 */

const require = createRequire(import.meta.url);
const vosk = require("vosk-koffi") as typeof VoskTypes;

export interface RecognizedWord {
  word: string;
  start: number;
  end: number;
  conf: number;
}

export interface Recognition {
  text: string;
  words: RecognizedWord[];
}

export function loadModel(modelPath: string): VoskTypes.Model {
  if (!existsSync(modelPath)) {
    throw new Error(`Vosk model not found at ${modelPath} — run \`pnpm setup:model\` in services/voice-control.`);
  }
  vosk.setLogLevel(-1);
  return new vosk.Model(modelPath);
}

function toBuffer(frame: Int16Array): Buffer {
  return Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
}

function parse(raw: unknown): Recognition {
  const r = raw as { text?: string; result?: RecognizedWord[]; alternatives?: Array<{ text?: string; result?: RecognizedWord[] }> };
  const best = r.alternatives?.[0] ?? r;
  return { text: (best.text ?? "").trim(), words: (best.result ?? []).map((w) => ({ ...w, conf: w.conf ?? 1 })) };
}

/** A streaming recognizer over one utterance at a time. */
export class VoskStream {
  private readonly recognizer: VoskTypes.Recognizer<object>;
  /** Words finalized mid-stream (Vosk emits a result at internal pauses). */
  private words: RecognizedWord[] = [];
  private texts: string[] = [];

  constructor(model: VoskTypes.Model, sampleRate: number, grammar?: string[]) {
    this.recognizer = new vosk.Recognizer(grammar ? { model, sampleRate, grammar } : { model, sampleRate }) as VoskTypes.Recognizer<object>;
    this.recognizer.setWords(true);
  }

  feed(frame: Int16Array): void {
    if (this.recognizer.acceptWaveform(toBuffer(frame))) {
      const r = parse(this.recognizer.result());
      if (r.text) this.texts.push(r.text);
      this.words.push(...r.words);
    }
  }

  partial(): string {
    return (this.recognizer.partialResult().partial ?? "").trim();
  }

  /** Everything recognized since the last reset; resets for the next utterance. */
  finish(): Recognition {
    const r = parse(this.recognizer.finalResult());
    const out = {
      text: [...this.texts, r.text].filter(Boolean).join(" "),
      words: [...this.words, ...r.words],
    };
    this.reset();
    return out;
  }

  reset(): void {
    this.recognizer.reset();
    this.words = [];
    this.texts = [];
  }
}
