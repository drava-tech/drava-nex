/**
 * TRAVIS traditional voice control (no LLM):
 *   mic -> WebRTC VAD -> Vosk "travis" grammar -> Vosk STT -> rule matcher
 *       -> CMS internal voice API -> ElevenLabs TTS -> speaker
 *
 * Run: pnpm --filter @platform/voice-control start
 */
import { join } from "node:path";
import { loadConfig, SERVICE_ROOT } from "./config/config.js";
import { loadRegistry } from "./commands/registry.js";
import { CmsClient } from "./cms/client.js";
import { Microphone } from "./audio/microphone.js";
import { Speaker, wakeChime } from "./audio/speaker.js";
import { VadSegmenter, WebRtcVad } from "./audio/vad.js";
import { loadModel } from "./speech/vosk.js";
import { CommandTranscriber } from "./speech/stt.js";
import { WakeWordDetector } from "./wakeword/wake-word.js";
import { ElevenLabsTts } from "./tts/elevenlabs.js";
import { EventLog } from "./utils/logger.js";
import { Pipeline, type Voice } from "./pipeline.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const log = new EventLog();
  const registry = loadRegistry(join(SERVICE_ROOT, "config", "commands.json"));
  const { sampleRate, frameMs } = config.audio;
  const frameLength = (sampleRate * frameMs) / 1000;

  if (!config.cms.secret) console.warn("[config] TRAVIS_VC_KEY is not set — every CMS command will fail.");
  const tts = new ElevenLabsTts({ ...config.tts, sampleRate });
  if (!tts.configured) console.warn("[config] ELEVENLABS_API_KEY is not set — Travis will act but stay silent.");

  const model = loadModel(config.stt.modelPath);
  const vad = await WebRtcVad.create(sampleRate, frameLength, config.vad.mode);
  const speaker = new Speaker(sampleRate, config.audio.outputDevicePreference, config.audio.speakerGain);
  const chimeSpeaker = new Speaker(sampleRate, config.audio.outputDevicePreference, config.audio.speakerGain);
  const chimePcm = wakeChime(sampleRate);

  const voice: Voice = {
    async say(text, onFirstAudio) {
      let first = true;
      try {
        for await (const chunk of tts.synthesize(text)) {
          if (first) {
            onFirstAudio();
            first = false;
          }
          await speaker.write(chunk);
        }
      } finally {
        await speaker.finish();
      }
    },
    chime() {
      void chimeSpeaker
        .write(chimePcm)
        .then(() => chimeSpeaker.finish())
        .catch((err) => console.error("[chime]", err));
    },
    prewarm: () => tts.prewarm(),
  };

  const pipeline = new Pipeline({
    config,
    registry,
    vad,
    segmenter: new VadSegmenter({ frameMs, ...config.vad }),
    wake: new WakeWordDetector(model, sampleRate, config.wakeWord),
    stt: new CommandTranscriber(model, sampleRate, config.wakeWord.word),
    cms: new CmsClient(config.cms),
    voice,
    log,
    onShutdown: () => shutdown("voice command"),
  });

  // Travis stops only on Ctrl+C or "Travis, shut down". Anything else (a
  // Bluetooth headset dropping, a stray error) is logged and recovered from.
  const mic = new Microphone(frameLength, config.audio.inputDevicePreference);
  const startMic = (): void => {
    try {
      const device = mic.start(
        (frame) => pipeline.onFrame(frame),
        (err) => {
          console.error("[mic] capture failed, restarting in 2s:", err);
          mic.stop();
          setTimeout(startMic, 2000);
        }
      );
      log.event("MIC_STARTED", { device, speaker: speaker.deviceName, cms: config.cms.baseUrl, commands: registry.patterns.length });
    } catch (err) {
      console.error("[mic] could not open the microphone, retrying in 2s:", err);
      setTimeout(startMic, 2000);
    }
  };

  shutdown = (reason: string) => {
    console.log(`Travis shutting down (${reason}).`);
    mic.stop();
    speaker.release();
    chimeSpeaker.release();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("Ctrl+C"));
  process.on("SIGTERM", () => shutdown("terminated"));
  process.on("uncaughtException", (err) => console.error("[travis] unexpected error (still running):", err));
  process.on("unhandledRejection", (err) => console.error("[travis] unexpected error (still running):", err));

  startMic();
  console.log(`Say "${config.wakeWord.word}" followed by a command. Ctrl+C or "${config.wakeWord.word}, shut down" to quit.`);
}

let shutdown: (reason: string) => void = () => process.exit(0);

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
