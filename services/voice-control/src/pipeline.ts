import { randomUUID } from "node:crypto";
import type { VoiceControlConfig } from "./config/config.js";
import type { Registry } from "./commands/registry.js";
import { matchCommand, type CommandMatch } from "./commands/matcher.js";
import { resolveCommand, type Resolution } from "./commands/resolve.js";
import { executeResolution } from "./cms/execute.js";
import type { CmsClient } from "./cms/client.js";
import type { EventLog } from "./utils/logger.js";
import { normalizeTokens } from "./utils/text.js";
import type { VadSegmenter, WebRtcVad } from "./audio/vad.js";
import type { Transcript } from "./speech/stt.js";

/**
 * Glues the independent layers together:
 *
 *   mic frame -> VAD -> segment -> wake word (+ command STT) -> matcher -> CMS -> TTS
 *
 * States:
 *   idle      every speech segment goes to both the "travis" grammar and the
 *             open-vocabulary recognizer; a one-breath "Travis, turn on the
 *             lights" is split at the wake word's end timestamp.
 *   listening "Travis" was said alone: the next segment is the command. After
 *             nudgeAfterMs of silence Travis asks what's wanted (the answer
 *             needs no second "Travis"); gives up after awakeTimeoutMs.
 *   busy      executing + speaking. The mic is ignored until the reply has
 *             fully played — half duplex, so Travis never hears himself.
 *
 * There is no follow-up window: after a reply, the next command needs
 * "Travis" again. A clarifying question ("Which screen?") is remembered
 * briefly so "Travis, the lobby screen" completes the original command.
 */

export interface WakeDetector {
  feed(frame: Int16Array): boolean;
  finish(): { detected: boolean; confidence: number; wordEnd: number | null };
  reset(): void;
}

export interface Transcriber {
  feed(frame: Int16Array): void;
  finish(afterSec?: number): Transcript;
  reset(): void;
}

export interface Voice {
  /** Speak and resolve when fully played; onFirstAudio fires at the first audible chunk. */
  say(text: string, onFirstAudio: () => void): Promise<void>;
  chime(): void;
  prewarm(): void;
}

export interface PipelineDeps {
  config: VoiceControlConfig;
  registry: Registry;
  vad: Pick<WebRtcVad, "isSpeech" | "reset">;
  segmenter: VadSegmenter;
  wake: WakeDetector;
  stt: Transcriber;
  cms: Pick<CmsClient, "send" | "setSessionId">;
  voice: Voice;
  log: EventLog;
  /** Called after the goodbye has been spoken for "Travis, shut down". */
  onShutdown?: () => void;
}

type State = "idle" | "listening" | "busy";

interface PendingAsk {
  match: CommandMatch;
  slot: string;
  expires: number;
}

export class Pipeline {
  private state: State = "idle";
  private wakeAnnounced = false;
  private nudged = false;
  private nudgeTimer: NodeJS.Timeout | null = null;
  private timeoutTimer: NodeJS.Timeout | null = null;
  private pending: PendingAsk | null = null;
  private shutdownRequested = false;

  constructor(private readonly deps: PipelineDeps) {}

  get currentState(): State {
    return this.state;
  }

  /** Feed one mic frame. Synchronous: slow work (CMS, TTS) runs detached. */
  onFrame(frame: Int16Array): void {
    if (this.state === "busy") return;
    const { vad, segmenter } = this.deps;
    for (const ev of segmenter.push(frame, vad.isSpeech(frame))) {
      if (ev.type === "start") {
        this.deps.log.event("SPEECH_STARTED", { state: this.state });
        this.clearNudge();
        for (const f of ev.frames) this.feedSegment(f);
      } else if (ev.type === "frame") {
        this.feedSegment(ev.frame);
      } else {
        this.deps.log.event("SPEECH_ENDED", { reason: ev.reason });
        this.onSegmentEnd();
      }
    }
  }

  private feedSegment(frame: Int16Array): void {
    this.deps.stt.feed(frame);
    if (this.state !== "idle") return;
    if (this.deps.wake.feed(frame)) this.announceWake("partial");
  }

  private announceWake(via: "partial" | "final", confidence?: number): void {
    if (this.wakeAnnounced) return;
    this.wakeAnnounced = true;
    this.deps.cms.setSessionId(randomUUID());
    this.deps.log.event("WAKE_WORD_DETECTED", { via, ...(confidence !== undefined ? { confidence } : {}) });
    if (this.deps.config.session.wakeChime) this.deps.voice.chime();
    this.deps.voice.prewarm();
  }

  private onSegmentEnd(): void {
    if (this.state === "listening") {
      const transcript = this.deps.stt.finish(0);
      // Noise that VAD let through: keep waiting for the real command.
      if (!transcript.text) return;
      this.stopListening();
      void this.handleCommand(transcript);
      return;
    }

    const wake = this.deps.wake.finish();
    if (!wake.detected) {
      this.deps.stt.reset();
      if (this.wakeAnnounced) {
        // Partial hit the final result didn't confirm: chimed, but act on nothing.
        this.deps.log.event("COMMAND_REJECTED", { reason: "wake_word_not_confirmed", confidence: wake.confidence });
        this.endExchange();
      }
      return;
    }
    this.announceWake("final", wake.confidence);

    const transcript = this.deps.stt.finish(wake.wordEnd ?? 0);
    if (transcript.text) {
      void this.handleCommand(transcript);
    } else {
      this.startListening();
    }
  }

  private startListening(): void {
    this.state = "listening";
    const { nudgeAfterMs, awakeTimeoutMs } = this.deps.config.session;
    this.nudgeTimer = setTimeout(() => void this.nudge(), nudgeAfterMs);
    this.timeoutTimer = setTimeout(() => {
      this.stopListening();
      this.deps.log.event("COMMAND_REJECTED", { reason: "no_command_before_timeout" });
      this.endExchange();
    }, awakeTimeoutMs);
  }

  private async nudge(): Promise<void> {
    this.nudgeTimer = null;
    if (this.state !== "listening" || this.nudged) return;
    this.nudged = true;
    this.state = "busy";
    this.clearTimeout();
    await this.speak("Yes? What would you like?");
    // The answer needs no second "Travis": listen again with a fresh timeout.
    this.deps.segmenter.reset();
    this.deps.stt.reset();
    this.state = "listening";
    this.timeoutTimer = setTimeout(() => {
      this.stopListening();
      this.deps.log.event("COMMAND_REJECTED", { reason: "no_command_before_timeout" });
      this.endExchange();
    }, this.deps.config.session.awakeTimeoutMs);
  }

  private async handleCommand(transcript: Transcript): Promise<void> {
    this.state = "busy";
    const { config, log } = this.deps;
    log.event("STT_RESULT", { text: transcript.text, confidence: round(transcript.confidence) });

    let reply: string;
    if (transcript.confidence < config.stt.minConfidence) {
      log.event("COMMAND_REJECTED", { reason: "low_stt_confidence", confidence: round(transcript.confidence) });
      reply = "Sorry, I didn't catch that.";
    } else {
      reply = await this.runText(transcript.text);
    }
    await this.speak(reply);
    this.endExchange();
    if (this.shutdownRequested) this.deps.onShutdown?.();
  }

  /** Match, resolve and execute one command's text; returns what to say. */
  private async runText(text: string): Promise<string> {
    const { config, registry, log } = this.deps;
    const match = matchCommand(text, registry, config.matching);

    let resolution: Resolution;
    if (match.ok) {
      this.pending = null;
      log.event("COMMAND_MATCHED", {
        intent: match.intent,
        params: match.params,
        method: match.method,
        confidence: round(match.confidence),
      });
      resolution = resolveCommand(match, config.defaults);
    } else if (this.pending && this.pending.expires > Date.now()) {
      // An answer to "Which screen?": the whole utterance is the name.
      const { match: prior, slot } = this.pending;
      this.pending = null;
      const value = normalizeTokens(text, registry.rewrites)
        .map((t) => t.source)
        .join(" ");
      const completed = { ...prior, params: { ...prior.params, [slot]: value } };
      log.event("COMMAND_MATCHED", { intent: prior.intent, params: completed.params, method: "answer" });
      resolution = resolveCommand(completed, config.defaults);
    } else {
      log.event("COMMAND_REJECTED", { reason: match.reason, normalized: match.normalized, best: match.best });
      return "Sorry, I don't know that command.";
    }

    if (resolution.kind === "ask" && match.ok) {
      this.pending = { match, slot: resolution.slot, expires: Date.now() + config.session.pendingAskMs };
      return `${resolution.question} Say Travis, then the name.`;
    }
    if (resolution.kind === "reply" && resolution.shutdown) this.shutdownRequested = true;
    return executeResolution(resolution, this.deps.cms, log);
  }

  private async speak(text: string): Promise<void> {
    const { log, voice } = this.deps;
    let started = false;
    try {
      await voice.say(text, () => {
        started = true;
        log.event("TTS_STARTED", { text });
      });
      if (started) log.event("TTS_ENDED");
    } catch (err) {
      // No fallback voice by design: log and stay silent.
      console.error(`[tts] ${err instanceof Error ? err.message : String(err)} — reply not spoken: "${text}"`);
    }
  }

  private endExchange(): void {
    this.clearNudge();
    this.clearTimeout();
    this.deps.log.endExchange();
    this.deps.segmenter.reset();
    this.deps.vad.reset();
    this.deps.wake.reset();
    this.deps.stt.reset();
    this.deps.cms.setSessionId(null);
    this.wakeAnnounced = false;
    this.nudged = false;
    this.state = "idle";
  }

  private stopListening(): void {
    this.clearNudge();
    this.clearTimeout();
  }

  private clearNudge(): void {
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.nudgeTimer = null;
  }

  private clearTimeout(): void {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = null;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
