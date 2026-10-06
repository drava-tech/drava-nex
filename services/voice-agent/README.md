Setup: install [Ollama](https://ollama.com/download), then
`ollama pull qwen3:8b`. Whisper's model (`stt_model`, default `small`) is
downloaded on first run, or point it at a local folder. CUDA needs cuBLAS 12
and cuDNN 9: set `stt_cuda_lib_dir` to a folder with them (a global
`torch\lib` works) or `pip install nvidia-cublas-cu12 nvidia-cudnn-cu12`.
Each exchange prints `⚡ Fast path: ...` or `🧠 qwen3:8b ...` so you can see
which path answered.

# Voice Agent

TRAVIS, a room-mic voice agent for the platform: wake-word activated (the
wake phrase is "Hey Travis" by default — see **Wake word** below), running on a
local language model with ElevenLabs for speech, with two tools that
drive the CMS exactly the way an operator's own click would.

- **device_control** — lights (Casambi), the AC/IR remote (Tuya), and the
  front door lock (Home Assistant) — via `apps/api`'s existing device drivers.
- **screen_control** — assign an experience or media item to a named screen,
  or blank/resume one — via `apps/api`'s existing screen mutations.

Both tools call `apps/api`'s `/api/internal/voice/*` routes
(`apps/api/src/routes/voice-internal.ts`), which forward into one shared
implementation (`apps/api/src/services/voice-actions.ts`) — the same one an
in-CMS voice surface would use if added later. This service never talks to
hardware or the database directly; it is purely a voice front end onto
controls the CMS already has. Name resolution ("the lobby lights", "screen 2")
happens server-side, so a spoken target that's ambiguous comes back as a
clarifying question instead of a guess.

This is a trimmed slice of the standalone TRAVIS project (a broader
experience-center assistant with Rubik's cube coaching, LEGO coaching, face
recognition, and a photo-puzzle game). Only the general voice engine and the
two CMS-facing tools are here — the rest intentionally isn't, since it's
unrelated to controlling this platform.

Also included: `knowledge_search` (local retrieval over `knowledge/*.md`,
edit freely for your venue), `save_memory` (a small long-term memory), and
`show_visual` (an on-screen visual walkthrough).

## Project structure

```
main.py            entry point only: venv re-exec, env setup, start UI + agent
settings.py        paths, audio constants, config loader (config/api_keys.json + env)
console.py         UTF-8 console setup
ui.py              PyQt6 face/HUD window
agent/             the voice agent
  local.py           TravisLocal: utterance loop, VAD -> STT -> command, startup
  commands.py        CommandMixin: pending answers, fast path, multi-action, model rounds
  base.py            TravisBase: shared state, built from the mixins below
  wake_word.py       WakeWordMixin        speaker_gate.py   SpeakerGateMixin
  mic_listener.py    MicListenerMixin     playback.py       PlaybackMixin (chime, output)
  exchange_state.py  ExchangeStateMixin   tool_runner.py    ToolRunnerMixin
  tool_declarations.py, vocabulary.py, exchange_log.py
speech/            vad, stt (Whisper), elevenlabs_stream (TTS), transcript_gate, language_gate
nlu/               command_matcher, multi_action, pending, repairs, intent, relevance,
                   local_llm (Ollama), prompt_local.txt
safety/            action_guard (ask, don't guess), reply_guard (never confirm what didn't happen)
audio/             devices (mic/speaker lookup, gain), speaker + target_speaker_gpu (speaker gate)
wake/              detectors (Vosk phrase matcher, openWakeWord)
actions/           CMS client and the device/screen/inventory tools
rag/, memory/      knowledge search and long-term memory
config/            api_keys.json, commands.json, capabilities.json
knowledge/         documents Travis can answer from
bench/, tests/     benchmark harness and unit tests
```

Dependencies point one way: `agent` -> `nlu`/`safety`/`speech`/`audio`/`wake`/`actions` ->
`settings`. The lower packages never import `agent`.

## How it works

`TravisLocal` in `agent/local.py` (the Gemini Live backend was removed on 2026-10-05):

1. **End of speech** — WebRTC VAD (`speech/vad.py`) cuts one utterance out of
   the awake mic stream after `vad_end_silence_ms` (500) of silence.
2. **Speech-to-text** — faster-whisper on the GPU (`speech/stt.py`). The language is
   detected first: a confidently non-English utterance is dropped silently
   (forcing `language="en"` would _translate_ it into an English command
   instead). Unsure detections are transcribed as English.
3. **Fast path** — `config/commands.json` (a Python port of
   `services/voice-control`'s matcher, `nlu/command_matcher.py`) runs known
   commands straight away, no LLM.
4. **Relevance gate** (`nlu/relevance.py`, `relevance_gate`) — TRAVIS only helps with the
   room, screens, the experience center/company and itself. A request that names a
   room thing passes at once; anything else gets a ~0.3s yes/no review by the same
   model, which declines general questions ("what's the capital of France") and, in
   mixed ones ("unlock the door and tell me a joke"), keeps only the in-scope part
   ("I can't help with the rest." is added). The main model never sees the rest.
   Company questions are answered only from `knowledge/` via `knowledge_search`
   (fill in `knowledge/cms_platform.md`; until then Travis says it has no such detail).
5. **LLM** — what passes goes to Qwen3-8B in Ollama (`nlu/local_llm.py`,
   `nlu/prompt_local.txt`) with the same tools. Thinking is off.
6. **Speech** — ElevenLabs, unchanged.

Wake word, chime, nudge and mic-closing rules are `TravisBase`'s code. No
barge-in: the mic is ignored while a command runs and while Travis speaks.
`knowledge_search` embeds with Gemini (`gemini-embedding-001`), so it is only
available when `gemini_api_key` is set. Nothing else needs a Gemini key.

## Reviewing what it heard

```bash
cd services/voice-agent
.venv\Scripts\python.exe -u main.py        # say "Hey Travis, ..."
.venv\Scripts\python.exe -m bench.voice_bench review --limit 20
```

`review` shows, for each thing it heard: what Whisper wrote, why it was ignored
(not English, false wake, noise...), which path handled it (command list / several actions / list +
model / model / declined), each action sent or held back, what Travis said, and the time from end
of speech to the first word.

When something goes wrong, the line in `logs/exchanges.jsonl` is what to look at (or send): it says
whether Whisper misheard, the list missed it, the guard asked, or the model got it wrong.

## Prerequisites

- A microphone and speakers on the machine this runs on. Like TRAVIS, this
  runs on the host (not in Docker) — see `agent/` (`sounddevice`) and `ui.py` (PyQt6).
- Local backend: an NVIDIA GPU (8 GB is enough for Qwen3-8B + Whisper small)
  and Ollama. An ElevenLabs key for speech.
- `apps/api` running and reachable, with `VOICE_AGENT_SECRET` set (see the
  repo root's `.env.example`).

## Setup (what you do yourself)

Cloning gives you the code, `config/commands.json` and `config/api_keys.example.json`. These
are **not** in git, so each teammate sets them up on their own machine:

| #   | Step                                                                                                                                                           | Why it isn't in the repo               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1   | **Python 3.11 venv + packages**: `python -m venv .venv`, activate it, `pip install -r requirements.txt`                                                        | The venv is per machine (gitignored)   |
| 2   | **Config file**: `cp config/api_keys.example.json config/api_keys.json`, then fill it in (below)                                                               | It holds secrets, so it is gitignored  |
| 3   | **Ollama + model**: install [Ollama](https://ollama.com), then `ollama pull qwen3:8b`                                                                          | Separate app; the model is ~5 GB       |
| 4   | **CUDA libraries for Whisper**: set `stt_cuda_lib_dir` to a folder with cuBLAS 12 + cuDNN 9, or `pip install nvidia-cublas-cu12 nvidia-cudnn-cu12` in the venv | Needs an NVIDIA GPU and the right DLLs |
| 5   | **Your keys**: your own ElevenLabs API key and voice ID, and the `cms_voice_secret` from whoever runs the CMS                                                  | Secrets are never committed            |
| 6   | **Mic and speaker**: set `mic_device_name` / `speaker_device_name` to your devices                                                                             | Device names differ per machine        |
| 7   | **CMS reachable**: `apps/api` running at `cms_api_base_url` with a matching `VOICE_AGENT_SECRET`                                                               | Runs on the server                     |
| 8   | **First run online**: the Whisper and Vosk wake-word models download themselves once                                                                           | Cached on disk after that              |

Then start it: `python main.py` (see **Run**). If Travis is silent, check the ElevenLabs key
first; there is no fallback voice.

Do not commit `config/api_keys.json`, `logs/` or `bench/recordings/`.

Edit `config/api_keys.json`:

- `elevenlabs_api_key`, `elevenlabs_voice_id` — spoken replies.
- `gemini_api_key` — optional; only for `knowledge_search`.
- `cms_api_base_url` — the production CMS API address (required, no default).
- `cms_voice_secret` — must match `apps/api`'s `VOICE_AGENT_SECRET`.
- `wake_word_engine` and its settings — see **Wake word** below.

Optional voice-only feature (off by default): `speaker_gate_enabled` filters
out bystander chatter so only the person who said the wake phrase is heard,
using a local voice-embedding model (`pip install resemblyzer`). Its
`speaker_extraction_backend` can be set to the experimental
`"gpu_separation_experimental"` GPU source-separation backend (needs a CUDA
torch build + `speechbrain`) instead of the default CPU Resemblyzer gate —
see `audio/target_speaker_gpu.py` and `bench/gpu_extraction_bench.py`.

TRAVIS only accepts commands spoken in English; anything else is ignored
silently — see `speech/language_gate.py`, plus Whisper's language detection
(`stt_reject_language_threshold` / `stt_english_floor`); non-Latin scripts are
dropped by the same gate.

## Wake word

Two interchangeable engines, chosen via `wake_word_engine` in
`config/api_keys.json` — neither needs an account or API key (unlike
Porcupine, whose free tier still needs a Picovoice AccessKey):

**`"vosk"` (the default here)** — full offline speech recognition
([Vosk](https://alphacephei.com/vosk/)); the wake phrase can be anything,
including the literal word "Travis", with zero training. Set
`wake_word_phrase` (default `"travis"`). Under the hood it runs a small
English recognition model constrained to just that phrase plus any
`wake_word_variants` (default: `["travel"]`, a common mishearing of "travis")
and a catch-all token, so it stays fast and doesn't get confused by unrelated
speech — but it's still full ASR rather than a dedicated wake-word
classifier, so it uses more CPU than `"openwakeword"` and can occasionally
mishear a similar-sounding word. Note that variants only help if they're real
English words: Vosk's decoder can only output words already in its
dictionary, so made-up-looking phonetic spellings (useful with a fuzzier
cloud ASR, not so here) are silently ignored rather than improving recall.
The recognition model (~40MB) downloads automatically on first run and is
cached by the `vosk` package.

**`"openwakeword"`** — a dedicated, lightweight wake-word classifier
([openWakeWord](https://github.com/dscripka/openWakeWord)). Lighter on CPU
and more accurate, but only a handful of pretrained phrases are free without
training: `alexa`, `hey_mycroft`, `hey_jarvis`, `hey_rhasspy` (set via
`wake_word_model`; downloaded automatically). There's no pretrained "Travis"
— getting that word with this engine means training a free custom model via
openWakeWord's documented Google Colab notebook (no account needed, ~30-60
minutes, synthetic voice data), then pointing `wake_word_model` at the
resulting `.onnx`/`.tflite` file's path. `wake_word_threshold` (0-1, default
0.5) trades false triggers against missed ones.

Either way, if the configured engine fails to import or its model fails to
load, the agent logs a warning and falls back to always-listening (no
wake-word gating at all) rather than refusing to start.

## Latency

There's no separate spoken acknowledgment when the wake word fires (e.g. a
"Yes?"); a short chime plays instead. `vad_end_silence_ms` (default 500) is how long
you must be quiet before the VAD decides you're done — lower is snappier but risks
cutting off a natural mid-sentence pause. Every exchange prints a T0-T9 timing report.

## Run

```bash
python main.py
```

Say "Travis" (or whatever `wake_word_phrase`/`wake_word_model` is set to),
wait for the listening state, then speak naturally — "turn on the lobby
lights," "push the welcome experience to screen 2," "blank screen 3," "lock
the door."

## Development checks

```bash
python -m compileall main.py ui.py actions agent audio nlu safety speech wake memory rag tests
python -m unittest discover -s tests -v
ruff check .
ruff format .
```
