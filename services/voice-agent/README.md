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
  planning.py        PlanMixin: plan -> resolved targets -> checked CMS calls -> reply
  tool_declarations.py, vocabulary.py, exchange_log.py
speech/            vad, stt (Whisper), elevenlabs_stream (TTS), transcript_gate, language_gate
nlu/               planner + plan + resolver (what was MEANT -> real targets), prompt_planner.txt,
                   command_matcher, multi_action, pending, repairs, intent, relevance,
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
   `services/voice-control`'s matcher, `nlu/command_matcher.py`) runs a sentence that is
   *exactly* a known command straight away, no LLM. It is only a latency shortcut: a device
   or screen slot takes only a name from the room's alias list, so wording such as
   "brightness of all" can never be mistaken for a device name. Everything else is understood
   by meaning in step 4.
4. **Planner** — what the fast path didn't take is *understood*, not matched. Qwen3-8B (Ollama, thinking off,
   JSON constrained to a schema) reads the sentence plus the room's real names and what was
   just discussed, and writes a plan (`nlu/plan.py`): per action an `op` (the existing
   `device_control`/`screen_control` actions), a described target (`type`, `scope` all /
   specific / group / reference, optional name / location / index), parameters, and a `quote`
   of the words that asked for it. Sentences are split into actions by meaning, not at "and".
   The CMS side then decides (`nlu/resolver.py`, `agent/planning.py`): "all lights" is a
   scope, expanded to the lights that exist; a spoken name is matched to a real one (alias,
   then a close spelling with the same digits); "them" / "the second one" use what the last
   answer listed or the last command touched; a place with no matching device, an unsaid
   screen or an unsaid number is never guessed: the clear parts run and one natural question
   names the real choices, and the half-finished action waits for the answer. An action whose
   quote isn't in the request is dropped; door/scene actions still need their cue words.
   Not a room request (questions, chat, company info, state questions) -> step 5. `semantic_planner: false` turns the planner off.
   Each exchange's plan is in `logs/exchanges.jsonl` (`plan`), before and after resolution.
5. **Relevance gate + model** (`nlu/relevance.py`, `relevance_gate`) — Only what the planner did not take as a room request gets here. TRAVIS only helps with the
   room, screens, the experience center/company and itself. A request that names a
   room thing passes at once; anything else gets a ~0.3s yes/no review by the same
   model, which declines general questions ("what's the capital of France") and, in
   mixed ones ("unlock the door and tell me a joke"), keeps only the in-scope part
   ("I can't help with the rest." is added). The main model never sees the rest.
   Questions about the company, the CMS, Travis or this place are answered only from `knowledge/` (see **Knowledge base**
   below); until a section is filled in Travis says it has no such detail.
   What passes is answered by Qwen3-8B with the tools (`nlu/local_llm.py`, `nlu/prompt_local.txt`).
6. **Speech** — ElevenLabs, unchanged.

Wake word, chime, nudge and mic-closing rules are `TravisBase`'s code. No
barge-in: the mic is ignored while a command runs and while Travis speaks.
Knowledge is embedded locally with Ollama (`nomic-embed-text`: `ollama pull nomic-embed-text` once); the index (`rag/index.npz`) rebuilds
itself when a knowledge file changes.

## Safe testing (safety mode and the room simulator)

**Safety mode is on by default.** Travis (`actions/cms_client.py`, the only code that sends device, screen and inventory requests) then
talks only to a localhost mock:

- allowed: plain `http`, a loopback host (or a name whose every DNS answer is loopback), port **4010** only. `127.0.0.1:4000` is the
  real `apps/api` and is refused; so is any LAN/real address, whatever `cms_api_base_url` or `CMS_API_BASE_URL` say.
- a refused request is never sent: it is printed as `[safety] BLOCKED ...`, appended to `logs/safety.jsonl`, and Travis says it was blocked.
- the real `cms_voice_secret` is never sent in safety mode (the mock's fixed secret is used); redirects are never followed and
  `HTTP(S)_PROXY` variables are ignored.
- to use the real CMS you must do both: `"safety_mode": false` in the config **and** `TRAVIS_ALLOW_REAL_DEVICES=1` in the environment.
  Startup then prints a banner. The allowed ports are a constant in `actions/safety.py`, not a config key.

`config/test_safe.json` is a config with no real keys. Run Travis against the simulator with
`TRAVIS_CONFIG=config/test_safe.json` (also honoured by `settings.py`).

**Room simulator** (`python -m bench.room_sim`, dashboard on `http://127.0.0.1:4010/`, loopback only): the experience center's rooms,
device names, IDs and command interface from `bench/voice_bench/names.py`, with the devices' limits (AC 16-30 C, brightness 0-100, TV
volume as 1-10 remote presses with no level readback, mute as a toggle), idempotent replay of a retried command, and per-device failures
(offline / slow with a delay / error reply) set from the dashboard or `RoomSim.set_fault`. `RoomSim.reset_all()` or the dashboard's
Reset restores the starting state. Not verified against the live inventory; load an export of it when available. One assumption: the
real API forwards an out-of-range AC temperature to Tuya, the simulator rejects it up front.

`python -m bench.room_sim.scenarios` runs spoken-style commands (normal, invalid, ambiguous, failing) through the real pipeline and
writes `bench/results/room_sim-<time>/report.md`: what Travis understood, the request it sent, the simulated room's change, its reply,
and every network connect the process made (`bench/room_sim/netaudit.py`).

## Knowledge base

`knowledge/*.md` is split into one searchable chunk per `## ` section. A question is read by the planner (topic, the question restated on
its own using the conversation so far, whether it asks for *more*, whether it asks how to reach the company), then software searches the
sections of the right group, skipping the ones already used when the visitor says "tell me more". The model answers from just those
sections and must say whether they really contain what was asked; its words are checked against them (`knowledge_grounding_min`), so a
question the file does not answer gets "I don't have that detail" and a few real topics to ask about instead of an invention. The contact line
(`company_contact_line`) is added by code, only to the first company overview or a contact question. Device commands never touch any of this.

File format:

```markdown
<!-- group: company -->          first line: company, travis or cms (a file with no such line: cms_platform.md is cms, travis.md is travis, the rest company)
# White Tusker               the document's name (not searched on its own)

## Clients                       one section = one chunk; keep each about ONE topic
<!-- say: our clients -->        how Travis names it when offering it: "I can tell you about our clients"
Boeing, Volvo...
```

Contact details (email, phone, website lines) stay in the file but are never shown to the model.

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

Audio keys in `config/api_keys.json` (see `config/api_keys.example.json`):

- `tts_sample_rate` (default `24000`): the one rate used for the ElevenLabs request (`pcm_<rate>`),
  the speaker stream, the wake chime and the output-device match. Allowed: 8000, 16000, 22050,
  24000, 44100; anything else falls back to 24000. Read once at start-up.
- `audio_allow_default_fallback` (default `false`): when `mic_device_name` / `speaker_device_name`
  is set but that device is missing (e.g. Bluetooth off), Travis keeps retrying and logs a warning
  instead of switching to the OS default mic or speaker. `true` restores the old fallback.
- `speaker_gain` (default `1.0`): software volume on top of the device volume.

Portfolio offer: from the SECOND real answer about White Tusker in a conversation (FAQ or knowledge), Travis asks "Would you like me to play
our portfolio on the main screen?" Once per conversation; not if the portfolio is already on that screen (read from the CMS) or the visitor
said no. "Yes" / "go ahead" / "play it" / "sure" plays it through the normal action path and the reply comes from the CMS result; "no" /
"not now" gets "Okay, no problem." Only offered when the CMS has exactly ONE experience whose title contains "portfolio" (or the one named in
`portfolio_experience`) and the screen `portfolio_screen` ("tusker 86", spoken as "main screen") exists. `portfolio_offer: false` turns it
off. The simulator (`python -m bench.room_sim`) has a "White Tusker Portfolio" experience for trying it without the real CMS.

## Written-down answers, room state and the follow-up window

- **FAQ and small talk** (`knowledge/faq.yaml`, `knowledge/smalltalk.yaml`, `nlu/canned.py`, `agent/canned_route.py`): a request that is not a
  command is matched to the *variants* of an entry by local embeddings (threshold `canned_threshold` 0.82, margin `canned_margin` 0.04, and
  `canned_min_fuzzy` 0.4 word overlap with the matched variant). It never matches a sentence with an action word (turn, switch, set, play, open,
  close, lock, unlock, increase, decrease, mute, start, stop, show) or a device name, and an entry whose `question_type` conflicts with the
  question word is rejected ("When was White Tusker founded" never gets the founders answer). **Only entries with `status: approved` are
  used** (`canned_statuses`; `TRAVIS_CANNED_STATUSES=draft,approved` for measurements). The answer is exactly the text in the file, plus the
  contact line for `add_email_line` entries. FAQ answers mark their sections used, so "tell me more" continues with new ones.
- **Pre-rendered audio**: `python -m tools.render_audio` checks (default) what is missing, the characters needed and the ElevenLabs quota;
  `--render` renders it, refusing above 20% of the quota left unless `--force`. Files go to `cache/tts/` by hash of text, voice, model and
  rate; a missing file means normal speech, so it is safe to render later and to re-run after editing the knowledge files.
- **Room state** (`nlu/room_state.py`, `agent/room_state.py`): "How many lights are there?", "Is the AC on?", "What is playing on the main
  screen?" are answered from live CMS lists, read-only. The door has no status read in the CMS, so Travis says so honestly (and never locks or
  unlocks on this route). A sentence that asks for a change is never taken for a question.
- **Follow-up window**: after Travis asks something (an offer, a clarification, a pending question) and has finished speaking it, a soft cue
  tone plays and the mic stays open for `followup_window_sec` (8; 0 turns it off) without "Hey Travis". `followup_cue: false` silences the tone.
  The spoken hints "Say Hey Travis, then your answer" still appear on other questions and are harmless inside the window.
- **Declines** now give one sentence declining plus one thing Travis can do, in three rotating wordings (`off_topic_reply` pins one).

End-of-speech detection (`endpointing`):

- `"webrtc"` (default): the old rule in `speech/vad.py`, WebRTC VAD plus `vad_end_silence_ms` of unbroken silence.
- `"smart"`: Silero VAD finds speech and pauses, and on a pause of `endpoint_pause_ms` (450) the Smart Turn model
  (`speech/smart_turn.py`) says whether the sentence is finished. Finished: it ends at once. Not finished: it keeps listening
  for up to `endpoint_grace_ms` (3000) of silence, and `in_speech` stays true so Travis does not ask "what do you need?" in a
  pause. `endpoint_max_ms` (10000) is a hard cap. `endpoint_gate_db` (18) is a last resort for noise the VAD cannot tell from
  speech: after `endpoint_gate_end_ms` (3000) of audio more than 18 dB below the utterance's own loud speech, it ends.
  `smart_turn_threshold` (0.5) is how sure Smart Turn must be. Two further triggers exist but are off because they cut real
  commands in testing: `endpoint_interval_ms` and `endpoint_gate_pause_ms` (see `speech/endpointing.py`).
  Needs two model files in `audio/models/` (gitignored, so download them once, over IPv4):
  `curl -4 -L -o audio/models/silero_vad.onnx https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx`
  and `curl -4 -L -o audio/models/smart-turn-v3.2-cpu.onnx https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.2-cpu.onnx`
  (Silero is MIT, Smart Turn v3.2 is BSD-2-Clause). If a model is missing Travis warns and uses the old rule.
- Measure it on your own clips with `python -m bench.endpointing.run` (see the docstrings in `bench/endpointing/`).

Do not commit `config/api_keys.json`, `logs/` or `bench/recordings/`.

Edit `config/api_keys.json`:

- `elevenlabs_api_key`, `elevenlabs_voice_id` — spoken replies.
- `company_contact_line` — what Travis says to give the company's contact (default: the White Tusker email, spelled for speech).
- `knowledge_min_score` (0.5), `knowledge_chunks` (2), `knowledge_grounding_min` (0.65) — search floor, sections per answer, and the word-overlap check.
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
