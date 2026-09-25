# voice-control

TRAVIS voice control without an LLM:

```
mic (16 kHz mono) -> WebRTC VAD -> Vosk "travis" grammar -> Vosk STT
    -> rule matcher (config/commands.json) -> apps/api /api/voice-control/* -> ElevenLabs TTS -> speaker
```

It only calls its own CMS API, `/api/voice-control/*` in apps/api
(`routes/voice-control.ts` and `services/voice-control.ts`), which is authenticated with
`x-travis-vc-key` = `TRAVIS_VC_KEY`, a secret used by nothing else.

| Route | Body |
| --- | --- |
| `POST /lights` | `{ action: on / off / set, target?, brightness?, color? }` (no target = every light) |
| `POST /ac` | `{ action: power_on / power_off / set_temp / set_mode, temp?, mode?, target? }` |
| `POST /volume` | `{ action: up / down / mute, times? }` (TV IR remote) |
| `POST /door` | `{ action: lock / unlock }` (Home Assistant) |
| `POST /screen` | `{ action: play / pause / stop, screen }` |
| `POST /content` | `{ kind: any / experience / media, content, screen }` |
| `GET /names` | every light / AC / screen / experience / media name it can act on |

The API resolves spoken names against the real rows. Errors list the real names.
It runs the same code as the CMS buttons (`applyLightState`, the IR driver, the
shared `setDoorLock`, `pushScreenContent`, `MEDIA_SET_PAUSED`). This service holds no
device credentials and never touches the database.

## Setup

```sh
pnpm install
pnpm --filter @platform/voice-control setup:model   # Vosk small English model -> models/ (gitignored)
cp services/voice-control/.env.example services/voice-control/.env   # TRAVIS_VC_KEY, ELEVENLABS_*
pnpm --filter @platform/voice-control devices       # check which mic/speaker config picks
pnpm --filter @platform/voice-control start
```

The API must be started with the same `TRAVIS_VC_KEY` (root `.env`). If it's unset there, the route rejects everything.

## Try phrases without a mic

```sh
pnpm --filter @platform/voice-control match "set the lights to fifty percent"
```

Prints the match (intent, parameters, confidence, exact/fuzzy) and the CMS request it would send.

## Configuration

- `config/voice-control.json`: audio devices (substring preferences, SmileDrive first),
  VAD timings, wake word and its decoys and confidence, STT confidence, fuzzy thresholds,
  session timings, TTS voice. Per-machine overrides go in `config/local.json` (gitignored).
- `defaults.screen`: a **real screen name** to use when a screen command names none
  ("pause"). Left `null`, Travis asks which one. `lightTarget` / `acTarget` are optional
  too: with no name, lights mean every light, and with a single AC the AC means that one.
- `config/commands.json`: every phrase, slot and CMS mapping. The syntax is documented
  at the top of the file. Add phrases there, not in code.

## Behavior

- One breath ("Travis, turn on the lights") or two steps ("Travis" … chime … "turn on the lights").
  After "Travis" alone, 2 s of silence gets "Yes? What would you like?", and the answer
  needs no second "Travis". It gives up after 8 s.
- Nothing is executed on low STT confidence, low match confidence, or a near tie
  between two intents. Door lock/unlock only ever match exactly.
- Volume goes to the TV's IR remote (`Volume Up` / `Volume Down` / `mute`, pressed `times` times).
  There is no absolute volume, so "set volume to 40" explains that instead.
- "Audio" play/pause/stop and bare "pause"/"stop" act on a screen: the spoken one,
  otherwise `defaults.screen`, otherwise Travis asks.
- Speech is ElevenLabs only. If it isn't configured or fails, Travis stays silent (logged).

## Latency log

Every stage prints a timestamped line (`MIC_STARTED`, `WAKE_WORD_DETECTED`, `SPEECH_STARTED`,
`SPEECH_ENDED`, `STT_RESULT`, `COMMAND_MATCHED`, `CMS_REQUEST`, `CMS_RESPONSE`, `TTS_STARTED`)
with `+ms` from the wake word, and each exchange ends with a one-line `LATENCY` summary.

## Tests

```sh
pnpm --filter @platform/voice-control test
```

`test/e2e-audio.test.ts` synthesizes commands with Windows' SAPI voice and runs them through
the real VAD, wake word, STT and matcher. It's skipped when the model isn't downloaded
or the OS isn't Windows.
