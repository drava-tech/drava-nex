"""TRAVIS voice-agent benchmark: finds weaknesses before new features land.

    python -m bench.voice_bench text      # intents, multi-action, gate, safety, context, errors, latency
    python -m bench.voice_bench audio     # STT/WER, VAD, wake word, meeting background speech, overlap
    python -m bench.voice_bench all       # both, then the report
    python -m bench.voice_bench report    # rebuild report.md from the latest run
    python -m bench.voice_bench record    # record your own clips (accent, distance, noise, 2 speakers)
    python -m bench.voice_bench score     # score recorded clips through the same pipeline

It exercises the production code (TravisLocal, the command matcher, the
relevance gate, the Ollama client, Whisper, the VAD and the Vosk wake word)
and replaces only what touches the outside world: the CMS is a recording mock
(mock_cms.py), speech output is captured, memory/knowledge/shutdown tools are
stubbed. See README.md in this folder for what each number does and doesn't mean.
"""
