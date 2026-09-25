/**
 * ElevenLabs streaming TTS -> raw 16 kHz 16-bit mono PCM chunks.
 *
 * Travis speaks with ElevenLabs only (voice "Will - Relaxed Optimist").
 * There is deliberately no fallback voice: if ElevenLabs is unconfigured or
 * fails, Travis stays silent and the error is logged.
 */

export interface TtsOptions {
  apiKey: string;
  voiceId: string;
  modelId: string;
  sampleRate: number;
  fetchImpl?: typeof fetch;
}

const API = "https://api.elevenlabs.io";

export class ElevenLabsTts {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TtsOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.options.apiKey);
  }

  /**
   * Open the HTTPS connection now (fire-and-forget, on the wake word) so the
   * TLS handshake overlaps the user's speech instead of delaying the reply;
   * fetch keeps the connection in its pool for the real request.
   */
  prewarm(): void {
    if (!this.configured) return;
    this.fetchImpl(API, { method: "HEAD" }).catch(() => {});
  }

  /** Yield PCM chunks as they stream in (sample-aligned). */
  async *synthesize(text: string): AsyncGenerator<Int16Array> {
    if (!this.configured) throw new Error("ELEVENLABS_API_KEY is not set.");
    const url = `${API}/v1/text-to-speech/${this.options.voiceId}/stream?output_format=pcm_${this.options.sampleRate}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { "xi-api-key": this.options.apiKey, "content-type": "application/json", accept: "audio/pcm" },
      body: JSON.stringify({ text, model_id: this.options.modelId }),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    // Network chunks can split a 2-byte sample; carry the odd byte over.
    let carry: Uint8Array | null = null;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      let bytes = chunk;
      if (carry) {
        const joined = new Uint8Array(carry.length + chunk.length);
        joined.set(carry);
        joined.set(chunk, carry.length);
        bytes = joined;
        carry = null;
      }
      const even = bytes.length - (bytes.length % 2);
      if (even < bytes.length) carry = bytes.slice(even);
      if (even === 0) continue;
      // Copy into an aligned buffer (Int16Array needs a 2-byte-aligned offset).
      const aligned = new Uint8Array(even);
      aligned.set(bytes.subarray(0, even));
      yield new Int16Array(aligned.buffer);
    }
  }
}
