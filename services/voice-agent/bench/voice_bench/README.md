# TRAVIS voice benchmark

Finds weaknesses in the voice agent *before* new features (meeting minutes, etc.) are built on top of it.
It exercises the production code and replaces only what touches the outside world.

```
python -m bench.voice_bench text            # ~340 cases: intents, phrasing variants, multi-action, ambiguity,
                                            #   invalid input, domain gate, room questions, context, faults, wake text
python -m bench.voice_bench audio           # Whisper WER, VAD, Vosk wake word, meeting talk, overlap, latency budget
python -m bench.voice_bench all             # both, then the report
python -m bench.voice_bench report          # rebuild report.md for the latest run
python -m bench.voice_bench record          # record your own clips (accent, distance, noise, a second speaker)
python -m bench.voice_bench score           # run those clips through the same pipeline
```

Useful flags: `--category variations`, `--id multi.`, `--limit 20`, `--repeats 3` (Qwen isn't deterministic, so
flaky cases show up as partial pass rates), `--cms-latency-ms 150` (add network time to the mock CMS),
`--audio-minutes 30` (longer meeting stream for the false-activation estimate), `--live-tts` (time ElevenLabs
first audio; spends a few of your credits). Needs Ollama running with `qwen3:8b`, and the GPU free.

Output goes to `bench/results/<timestamp>/`: `report.md` (the dashboard + ranked findings),
`failures.md` (every failing case: input / expected / actual / likely component / evidence / suggested fix),
`summary.json`, `text_results.jsonl` (one machine-readable row per case), `audio_results.json`.

## What is real and what is replaced

| Real (production code) | Replaced |
|---|---|
| `TravisLocal`: command list + fuzzy matcher, relevance gate, prompt, history, tools | the CMS: `mock_cms.py`, a real HTTP server answering like `apps/api` (same messages, error codes, name resolution, a little room state) and logging every request, with fault injection |
| Qwen3-8B through Ollama, Whisper on the GPU, WebRTC VAD, the Vosk wake-word class | speech output (captured, not sent to ElevenLabs), the microphone (`MicSim` reproduces the mic callback's pre-roll / debounce / awake window) |
| `cms_client` (timeouts, the one retry, error handling) | `knowledge_search` (needs Gemini), `save_memory` (would write your memory file), `shutdown_travis` (would exit the benchmark) |

## Limits worth knowing before you trust a number

- **Synthetic voices.** Audio tests use two Windows voices (David, Zira). They test the pipeline's mechanics,
  not accents, Indian English, real rooms or real people talking over each other. Use `record`/`score` for those.
- **Mock CMS** means CMS and device latency is ~0 and real hardware failures aren't modelled (only injected ones).
  The mock's room (devices, screens, content titles) is a fixture shaped like the real inventory.
- **TTS time** is not included unless `--live-tts`. "Speech end -> reply" in the report is therefore a lower bound.
- **Speaker gating** (resemblyzer) is off here, so overlapping-speech results show behaviour with no speaker filtering.
- **False activations per hour** come from a few minutes of synthetic meeting speech, with a 95% upper bound;
  treat it as a floor.
- **Judging replies** uses wording rules (`judge.py`) because the model's sentences vary. Each failure keeps the
  actual reply so you can overrule a verdict; where a rule was wrong, fix the rule, don't edit the result.
- The suite does **not** modify production behaviour. Failures are findings, not things to make pass.

## Reading a failure

Each case has a `kind` (see `cases.py`): `execute`, `partial`, `clarify`, `invalid`, `rejected_ok`, `decline`, `info`,
`unsupported`, `error`, `silent`. Severity in the report: **S1** wrong or unsafe action / false claim, **S2** wrong or
missing result, **S3** wording. The "likely component" is a first guess from the failure code and the path
(`fast` = command list, `llm` = Qwen, `decline` = relevance gate); the evidence line has the gate verdict, tool calls and
refused calls to confirm it.

## Adding cases

Append to the lists in `cases.py` using the helpers from `canon.py` (`AC("temp", 24)`, `L("on", "tusker edge")`,
`VOL("vol_up")`, ...). Write expectations from what the CMS really exposes. Run `tests/test_bench_harness.py`
(it checks the judge, the mock and the case list) before trusting new cases.
