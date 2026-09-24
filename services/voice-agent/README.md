# Voice Agent

TRAVIS, a room-mic voice agent for the platform: wake-word activated (the
wake word is "Travis" by default — see **Wake word** below), backed by
Gemini Live (native-audio, bidirectional streaming), with two tools that
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

## Prerequisites

- A microphone and speakers on the machine this runs on. Like TRAVIS, this
  runs on the host (not in Docker) — see `main.py`'s use of `sounddevice`/PyQt6.
- A Gemini API key.
- `apps/api` running and reachable, with `VOICE_AGENT_SECRET` set (see the
  repo root's `.env.example`).

## Setup

```bash
cd services/voice-agent
python -m venv .venv
.venv\Scripts\activate       # or: source .venv/bin/activate
pip install -r requirements.txt
cp config/api_keys.example.json config/api_keys.json
```

Edit `config/api_keys.json`:

- `gemini_api_key` — your Gemini API key.
- `cms_api_base_url` — where `apps/api` is reachable (default `http://localhost:4000`).
- `cms_voice_secret` — must match `apps/api`'s `VOICE_AGENT_SECRET`.
- `wake_word_engine` and its settings — see **Wake word** below.

Optional voice-only feature (off by default): `speaker_gate_enabled` filters
out bystander chatter so only the person who said the wake phrase is heard,
using a local voice-embedding model (`pip install resemblyzer`). Its
`speaker_extraction_backend` can be set to the experimental
`"gpu_separation_experimental"` GPU source-separation backend (needs a CUDA
torch build + `speechbrain`) instead of the default CPU Resemblyzer gate —
see `core/target_speaker_gpu.py` and `bench/gpu_extraction_bench.py`.

TRAVIS only accepts commands spoken in English (`asr_language_codes` in
config/api_keys.json, default `["en-IN", "en-US"]`); anything else gets
"Please speak in English." instead of being acted on — see
`core/language_gate.py`.

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
"Yes?") — that would cost a full extra Gemini Live round trip (network +
inference + speech synthesis) before your actual command is even processed,
which matters when the command is normally spoken in the same breath as the
wake word anyway ("Travis, turn off the lights"). The UI's state indicator
still flips to LISTENING instantly, just without an audible cue.

`voice_silence_duration_ms` (default 400) controls how long Gemini waits
after you stop talking before it decides you're done and starts responding —
lower is snappier but risks cutting off a natural mid-sentence pause; raise
it if that happens. Paired with `start_of_speech_sensitivity`/
`end_of_speech_sensitivity` set to HIGH in `main.py`, this is tuned for low
latency by default rather than Gemini Live's own (more conservative) defaults.

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
python -m compileall main.py ui.py actions core memory rag tests
python -m unittest discover -s tests -v
ruff check .
ruff format .
```
