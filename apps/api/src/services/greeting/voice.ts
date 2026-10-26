import { GREET_COMMAND, type GreetCommandValue } from "@platform/types";
import type { GreetingVoiceKind } from "./config.js";

/**
 * Where a greeting line is spoken. The greeting logic only ever calls
 * speak(); swapping the voice (GREETING_VOICE) never touches that logic, which
 * is how Travis slots in later. Whether it is spoken at all (the screen must be
 * showing, or about to show, the welcome screen) is decided by screen.ts.
 */
export interface GreetingVoice {
  readonly kind: GreetingVoiceKind;
  speak(text: string): void;
}

export type SendScreenCommand = (screenId: string, command: string, value?: unknown) => number;

/** The TV's own browser speaks, via a transient GREET screen command. */
export class ScreenVoice implements GreetingVoice {
  readonly kind = "screen" as const;

  constructor(
    private readonly screenId: string,
    private readonly send: SendScreenCommand,
    /** GREETING_VOICE_NAME: ask the TV to prefer this voice (it falls back if it isn't installed). */
    private readonly voiceName: string | null = null
  ) {}

  speak(text: string): void {
    const value: GreetCommandValue = { text, speak: true, ...(this.voiceName ? { voice: this.voiceName } : {}) };
    const sockets = this.send(this.screenId, GREET_COMMAND, value);
    if (sockets === 0) console.warn(`[greet] no screen connected to speak on: "${text}"`);
  }
}

/** Log only — for exercising the greeting logic silently. */
export class OffVoice implements GreetingVoice {
  readonly kind = "off" as const;

  speak(text: string): void {
    console.info(`[greet] (voice off) "${text}"`);
  }
}

/** Placeholder until Travis is wired in. */
export class TravisVoice implements GreetingVoice {
  readonly kind = "travis" as const;

  speak(text: string): void {
    console.warn(`[greet] travis voice not implemented — would say: "${text}"`);
  }
}

export function createGreetingVoice(
  kind: GreetingVoiceKind,
  screenId: string,
  send: SendScreenCommand,
  voiceName: string | null = null
): GreetingVoice {
  switch (kind) {
    case "off":
      return new OffVoice();
    case "travis":
      return new TravisVoice();
    default:
      return new ScreenVoice(screenId, send, voiceName);
  }
}
