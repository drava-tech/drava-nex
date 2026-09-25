import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Pipeline, type Voice } from "../src/pipeline.js";
import { VadSegmenter, WebRtcVad } from "../src/audio/vad.js";
import { loadRegistry } from "../src/commands/registry.js";
import { loadModel } from "../src/speech/vosk.js";
import { CommandTranscriber } from "../src/speech/stt.js";
import { WakeWordDetector } from "../src/wakeword/wake-word.js";
import { EventLog } from "../src/utils/logger.js";
import { loadConfig, SERVICE_ROOT } from "../src/config/config.js";

/**
 * Real audio end to end, minus mic/speaker/CMS: Windows' built-in SAPI voice
 * speaks each command to a 16 kHz WAV, which goes through the real WebRTC
 * VAD, Vosk wake-word grammar, Vosk STT and the command registry. Needs the
 * Vosk model (`pnpm setup:model`) and Windows; skipped otherwise.
 */

const config = loadConfig();
const canRun = process.platform === "win32" && existsSync(config.stt.modelPath);

function synthesize(texts: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "travis-e2e-"));
  const files = texts.map((_, i) => join(dir, `u${i}.wav`));
  const speakAll = texts
    .map((t, i) => `$s.SetOutputToWaveFile('${files[i]}', $fmt); $s.Speak('${t.replace(/'/g, "''")}');`)
    .join(" ");
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
      `$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono); ` +
      `${speakAll} $s.SetOutputToNull(); $s.Dispose()`,
  ]);
  return files;
}

/** PCM samples from a 16-bit mono WAV (walks chunks to find "data"). */
function readWav(path: string): Int16Array {
  const buf = readFileSync(path);
  let off = 12;
  while (off < buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") {
      const bytes = buf.subarray(off + 8, off + 8 + size);
      return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    off += 8 + size;
  }
  throw new Error(`No data chunk in ${path}`);
}

describe.skipIf(!canRun)("end to end on synthesized speech", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["Travis, turn on the lights.", { endpoint: "lights", body: { action: "on" } }],
    [
      "Travis, set the AC to twenty two degrees.",
      { endpoint: "ac", body: { action: "set_temp", temp: 22 } },
    ],
    ["Travis, lock the door.", { endpoint: "door", body: { action: "lock" } }],
    ["Travis, volume down.", { endpoint: "volume", body: { action: "down" } }],
  ];

  it(
    "wake word + command from real audio reach the CMS request",
    async () => {
      const files = synthesize([...cases.map(([t]) => t), "Turn on the lights."]);
      const model = loadModel(config.stt.modelPath);
      const registry = loadRegistry(join(SERVICE_ROOT, "config", "commands.json"));
      const frameLength = 480;

      async function run(file: string) {
        const cms = { send: vi.fn(async () => ({ message: "ok" })), setSessionId: () => {} };
        const voice: Voice = { say: async (_t, first) => first(), chime: () => {}, prewarm: () => {} };
        const lines: string[] = [];
        const pipeline = new Pipeline({
          config: { ...config, defaults: { lightTarget: null, acTarget: null, screen: null } },
          registry,
          vad: await WebRtcVad.create(16000, frameLength, config.vad.mode),
          segmenter: new VadSegmenter({ frameMs: 30, ...config.vad }),
          wake: new WakeWordDetector(model, 16000, config.wakeWord),
          stt: new CommandTranscriber(model, 16000, config.wakeWord.word),
          cms,
          voice,
          log: new EventLog((l) => lines.push(l)),
        });
        // Half a second of silence either side, like a real room pause.
        const pad = new Int16Array(8000);
        const pcm = readWav(file);
        const all = new Int16Array(pad.length * 2 + pcm.length);
        all.set(pcm, pad.length);
        for (let i = 0; i + frameLength <= all.length; i += frameLength) pipeline.onFrame(all.slice(i, i + frameLength));
        await vi.waitFor(() => expect(pipeline.currentState).not.toBe("busy"));
        return { cms, lines };
      }

      for (let i = 0; i < cases.length; i++) {
        const { cms, lines } = await run(files[i]!);
        expect(cms.send, `${cases[i]![0]}\n${lines.join("\n")}`).toHaveBeenCalledWith(cases[i]![1]);
      }

      // No wake word -> nothing happens.
      const { cms } = await run(files[cases.length]!);
      expect(cms.send).not.toHaveBeenCalled();
    },
    60_000
  );
});
