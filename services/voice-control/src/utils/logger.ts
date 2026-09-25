/**
 * Timestamped pipeline events, so end-to-end latency can be measured.
 *
 * Every event prints as one line with an ISO wall-clock time plus the delta
 * from the exchange's WAKE_WORD_DETECTED (and from the previous event), e.g.
 *
 *   2026-09-24T13:05:01.412Z STT_RESULT        +612ms (Δ188ms) {"text":"turn on the lights"}
 *
 * An "exchange" starts at WAKE_WORD_DETECTED and ends with endExchange(),
 * which prints a one-line summary of every stage.
 */

export type PipelineEvent =
  | "MIC_STARTED"
  | "WAKE_WORD_DETECTED"
  | "SPEECH_STARTED"
  | "SPEECH_ENDED"
  | "STT_RESULT"
  | "COMMAND_MATCHED"
  | "COMMAND_REJECTED"
  | "CMS_REQUEST"
  | "CMS_RESPONSE"
  | "TTS_STARTED"
  | "TTS_ENDED";

type Sink = (line: string) => void;

export class EventLog {
  private exchangeStart: number | null = null;
  private last: number | null = null;
  private marks: Array<{ event: PipelineEvent; at: number }> = [];

  constructor(
    private readonly sink: Sink = (line) => console.log(line),
    private readonly now: () => number = () => performance.timeOrigin + performance.now()
  ) {}

  event(event: PipelineEvent, detail?: Record<string, unknown>): void {
    const at = this.now();
    if (event === "WAKE_WORD_DETECTED") {
      this.exchangeStart = at;
      this.last = at;
      this.marks = [];
    }
    const sinceWake = this.exchangeStart === null ? "" : ` +${Math.round(at - this.exchangeStart)}ms`;
    const sinceLast = this.last === null ? "" : ` (Δ${Math.round(at - this.last)}ms)`;
    const extra = detail ? ` ${JSON.stringify(detail)}` : "";
    this.sink(`${new Date(at).toISOString()} ${event.padEnd(18)}${sinceWake}${sinceLast}${extra}`);
    this.last = at;
    if (this.exchangeStart !== null) this.marks.push({ event, at });
  }

  /** Print the per-stage summary for the current exchange and reset. */
  endExchange(): void {
    if (this.exchangeStart === null || this.marks.length === 0) return;
    const start = this.exchangeStart;
    const parts = this.marks.map((m) => `${m.event}=${Math.round(m.at - start)}`);
    this.sink(`LATENCY ${parts.join(" ")} (ms from wake word)`);
    this.exchangeStart = null;
    this.last = null;
    this.marks = [];
  }
}
