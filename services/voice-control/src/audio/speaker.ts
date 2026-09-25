import { PvSpeaker } from "@picovoice/pvspeaker-node";
import { pickDevice } from "./devices.js";

/**
 * Streaming 16-bit mono PCM playback on the configured output device.
 * write() accepts chunks as they arrive (TTS streams), so playback starts on
 * the first chunk instead of after the whole reply is synthesized.
 */
export class Speaker {
  private speaker: PvSpeaker | null = null;
  private startedAt = 0;
  private samplesWritten = 0;
  readonly deviceName: string;
  private readonly deviceIndex: number;

  constructor(
    private readonly sampleRate: number,
    devicePreference: string[],
    private readonly gain = 1
  ) {
    const device = pickDevice(PvSpeaker.getAvailableDevices(), devicePreference);
    this.deviceIndex = device.index;
    this.deviceName = device.name;
  }

  private ensureStarted(): PvSpeaker {
    if (!this.speaker) {
      this.speaker = new PvSpeaker(this.sampleRate, 16, { deviceIndex: this.deviceIndex, bufferSizeSecs: 20 });
    }
    if (!this.speaker.isStarted) {
      this.speaker.start();
      this.startedAt = Date.now();
      this.samplesWritten = 0;
    }
    return this.speaker;
  }

  async write(pcm: Int16Array): Promise<void> {
    const speaker = this.ensureStarted();
    // Playback is continuous from start(): if the stream ran dry (a slow TTS
    // chunk), the clock restarts from now for the remaining-time estimate.
    const playedMs = Date.now() - this.startedAt;
    if (playedMs > (this.samplesWritten / this.sampleRate) * 1000) {
      this.startedAt = Date.now() - (this.samplesWritten / this.sampleRate) * 1000;
    }
    this.samplesWritten += pcm.length;
    let samples = this.gain === 1 ? pcm : applyGain(pcm, this.gain);
    // write() takes what fits in the ring buffer; wait for room for the rest.
    while (samples.length > 0) {
      const written = speaker.write(toArrayBuffer(samples));
      samples = samples.subarray(written);
      if (samples.length > 0) await new Promise((r) => setTimeout(r, 20));
    }
  }

  /**
   * Resolve once everything written has played, then stop the stream.
   * PvSpeaker.flush() would do this but blocks the whole Node thread (and
   * with it the mic loop), so wait out the remaining audio asynchronously.
   */
  async finish(): Promise<void> {
    if (!this.speaker?.isStarted) return;
    const remainingMs = (this.samplesWritten / this.sampleRate) * 1000 - (Date.now() - this.startedAt);
    await new Promise((r) => setTimeout(r, Math.max(0, remainingMs) + 150));
    this.speaker?.stop();
    this.samplesWritten = 0;
  }

  release(): void {
    try {
      if (this.speaker?.isStarted) this.speaker.stop();
      this.speaker?.release();
    } catch {
      // already released
    }
    this.speaker = null;
  }
}

function toArrayBuffer(samples: Int16Array): ArrayBuffer {
  return samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) as ArrayBuffer;
}

export function applyGain(pcm: Int16Array, gain: number): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i]! * gain)));
  return out;
}

/** Short two-note chime played right after the wake word. */
export function wakeChime(sampleRate: number): Int16Array {
  const notes = [
    { freq: 880, ms: 70 },
    { freq: 1320, ms: 110 },
  ];
  const parts = notes.map(({ freq, ms }) => {
    const n = Math.round((sampleRate * ms) / 1000);
    const tone = new Int16Array(n);
    for (let i = 0; i < n; i++) {
      const envelope = Math.min(1, i / (n * 0.1), (n - i) / (n * 0.3));
      tone[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 9000 * envelope);
    }
    return tone;
  });
  const out = new Int16Array(parts.reduce((s, p) => s + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
