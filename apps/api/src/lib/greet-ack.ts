import type { GreetAck } from "@platform/types";

/**
 * The most recent report from a real TV about a spoken GREET. The kiosk runs
 * with devtools disabled, so this (surfaced by /api/greeting/status and the log)
 * is the only way to see whether speech actually worked there.
 *
 * Deliberately dependency-free: the gateway records into it without loading any
 * greeting code, and it is only ever written after a GREET was sent.
 */
export interface RecordedGreetAck extends GreetAck {
  screenId: string;
  at: string;
}

let last: RecordedGreetAck | null = null;

const clip = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;

export function recordGreetAck(screenId: string, ack: GreetAck): RecordedGreetAck {
  last = {
    screenId: screenId.slice(0, 100),
    spoke: ack.spoke === true,
    voice: clip(ack.voice, 200),
    error: clip(ack.error, 300),
    at: new Date().toISOString(),
  };
  console.info(
    last.spoke
      ? `[greet] TV spoke${last.voice ? ` with voice "${last.voice}"` : ""} (${last.screenId})`
      : `[greet] TV did NOT speak: ${last.error ?? "no reason given"} (${last.screenId})`
  );
  return last;
}

export function getLastGreetAck(): RecordedGreetAck | null {
  return last;
}

export function resetGreetAckForTests(): void {
  last = null;
}
