import createFvad from "@echogarden/fvad-wasm";

/**
 * WebRTC VAD (libfvad compiled to WASM — no native build, works on any Node).
 * Classifies one 10/20/30 ms frame of 16-bit PCM as speech or not.
 */
export class WebRtcVad {
  private constructor(
    private readonly mod: Awaited<ReturnType<typeof createFvad>>,
    private readonly handle: number,
    private readonly buffer: number,
    private readonly frameLength: number
  ) {}

  /** mode 0-3: higher = more aggressive at rejecting non-speech. */
  static async create(sampleRate: number, frameLength: number, mode: 0 | 1 | 2 | 3): Promise<WebRtcVad> {
    const mod = await createFvad();
    const handle = mod._fvad_new();
    if (!handle) throw new Error("fvad_new failed");
    if (mod._fvad_set_mode(handle, mode) !== 0) throw new Error(`Invalid VAD mode ${mode}`);
    if (mod._fvad_set_sample_rate(handle, sampleRate) !== 0) throw new Error(`Unsupported VAD sample rate ${sampleRate}`);
    return new WebRtcVad(mod, handle, mod._malloc(frameLength * 2), frameLength);
  }

  isSpeech(frame: Int16Array): boolean {
    if (frame.length !== this.frameLength) throw new Error(`VAD expects ${this.frameLength} samples, got ${frame.length}`);
    // HEAP16 is re-read every call: the WASM heap view is replaced if memory grows.
    this.mod.HEAP16.set(frame, this.buffer >> 1);
    const r = this.mod._fvad_process(this.handle, this.buffer, this.frameLength);
    if (r < 0) throw new Error("fvad_process failed");
    return r === 1;
  }

  reset(): void {
    this.mod._fvad_reset(this.handle);
  }
}

export type SegmentEvent =
  | { type: "start"; frames: Int16Array[] } // includes pre-roll, so the first syllable isn't clipped
  | { type: "frame"; frame: Int16Array }
  | { type: "end"; reason: "silence" | "max_length" };

export interface SegmenterOptions {
  frameMs: number;
  /** Consecutive speech needed to open a segment (debounces clicks). */
  speechStartMs: number;
  /** Trailing silence that closes a segment. */
  speechEndMs: number;
  /** Audio kept from before the start so the onset isn't lost. */
  preRollMs: number;
  maxUtteranceMs: number;
}

/**
 * Turns per-frame speech/non-speech decisions into utterance segments.
 * Pure state machine (no audio I/O), so it is unit-testable.
 */
export class VadSegmenter {
  private inSpeech = false;
  private speechRun = 0;
  private silenceRun = 0;
  private segmentFrames = 0;
  private preRoll: Int16Array[] = [];
  private readonly startFrames: number;
  private readonly endFrames: number;
  private readonly preRollFrames: number;
  private readonly maxFrames: number;

  constructor(options: SegmenterOptions) {
    const frames = (ms: number) => Math.max(1, Math.round(ms / options.frameMs));
    this.startFrames = frames(options.speechStartMs);
    this.endFrames = frames(options.speechEndMs);
    this.preRollFrames = frames(options.preRollMs);
    this.maxFrames = frames(options.maxUtteranceMs);
  }

  get active(): boolean {
    return this.inSpeech;
  }

  push(frame: Int16Array, isSpeech: boolean): SegmentEvent[] {
    if (!this.inSpeech) {
      this.preRoll.push(frame);
      if (this.preRoll.length > this.preRollFrames + this.startFrames) this.preRoll.shift();
      this.speechRun = isSpeech ? this.speechRun + 1 : 0;
      if (this.speechRun < this.startFrames) return [];
      this.inSpeech = true;
      this.silenceRun = 0;
      this.segmentFrames = this.preRoll.length;
      const frames = this.preRoll;
      this.preRoll = [];
      return [{ type: "start", frames }];
    }

    this.segmentFrames++;
    this.silenceRun = isSpeech ? 0 : this.silenceRun + 1;
    const events: SegmentEvent[] = [{ type: "frame", frame }];
    if (this.silenceRun >= this.endFrames) events.push(this.close("silence"));
    else if (this.segmentFrames >= this.maxFrames) events.push(this.close("max_length"));
    return events;
  }

  /** Abandon any open segment (e.g. while Travis is speaking). */
  reset(): void {
    this.inSpeech = false;
    this.speechRun = 0;
    this.silenceRun = 0;
    this.segmentFrames = 0;
    this.preRoll = [];
  }

  private close(reason: "silence" | "max_length"): SegmentEvent {
    this.reset();
    return { type: "end", reason };
  }
}
