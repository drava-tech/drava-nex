"""Wake-word detectors: openWakeWord and the Vosk phrase matcher."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

# pyrefly: ignore [missing-import]

from settings import (
    BASE_DIR,
)


class OpenWakeWordDetector:
    """Wraps openWakeWord: a tiny always-on neural classifier for one
    specific phrase. Fast and accurate, but only pretrained phrases are free
    without training a custom model (see VoskWakeWordDetector for that)."""

    def __init__(self, configured: str, threshold: float):
        from openwakeword.model import Model
        from openwakeword.utils import download_models

        # Always fetch the shared melspectrogram/embedding/VAD models —
        # required by both pretrained and custom-trained wake models.
        download_models([])

        is_custom_file = configured.lower().endswith((".onnx", ".tflite")) or (
            "/" in configured or "\\" in configured
        )
        if is_custom_file:
            model_path = str((BASE_DIR / configured).resolve())
            if not Path(model_path).exists():
                raise FileNotFoundError(
                    f"custom wake-word model not found: {model_path}"
                )
            self._name = Path(model_path).stem
            self._model = Model(
                wakeword_models=[model_path], inference_framework="onnx"
            )
        else:
            download_models([configured])  # pretrained name — fetch if needed
            self._name = configured
            self._model = Model(
                wakeword_models=[configured], inference_framework="onnx"
            )
        self._threshold = threshold

    @property
    def label(self) -> str:
        return self._name.replace("_", " ")

    def detect(self, pcm_bytes: bytes) -> bool:
        pcm = np.frombuffer(pcm_bytes, dtype=np.int16)
        scores = self._model.predict(pcm)
        return scores.get(self._name, 0.0) >= self._threshold


# The earlier AI_Experience_Center prototype's Google-STT wake detector
# matched "travis" plus several ASR mishearings ("trevis", "traves", "trav",
# "trevas"). That doesn't transfer directly to Vosk's grammar-restricted
# decoding: those aren't real English words, and a grammar can only ever
# output words already in the acoustic model's dictionary — anything else is
# silently dropped (confirmed by Vosk's own "Ignoring word missing in
# vocabulary" warning). Google's cloud ASR is fuzzy enough to emit those
# non-word spellings; Vosk's fixed-dictionary decoder cannot, regardless of
# what's listed here.
#
# "travel" used to be listed as a fallback (the one mishearing variant that's
# an actual dictionary word) — removed after it caused real false wake-ups:
# it's common enough in ordinary conversation ("we need to travel...") that
# bystander speech kept falsely engaging the agent. A missed "Travis" just
# costs saying it again; a false wake-up costs an unwanted chime and the
# agent listening to a conversation that was never meant for it — the worse
# failure mode of the two.
_DEFAULT_WAKE_VARIANTS: dict[str, list[str]] = {}


class VoskWakeWordDetector:
    """Wake-word detection via full offline speech recognition (Vosk)
    instead of a dedicated acoustic classifier. Lets the trigger phrase be
    anything (e.g. "travis") with zero training, at the cost of more CPU
    than a purpose-built wake-word model and occasional mishears on
    similar-sounding words. Grammar-restricted to the phrase and its known
    variants (+ a catch-all "[unk]" token) rather than open-vocabulary
    decoding, which keeps it fast and cuts down on unrelated false matches.

    Matches on PartialResult() streaming hypotheses, specifically the first
    one or two words of the current partial — not FINAL results
    (AcceptWaveform returning True). Finals only arrive at an utterance
    boundary (a real pause), which made "Travis, turn off the lights"
    spoken as one continuous sentence never finalize "Travis" on its own in
    time: the whole sentence had to finish before there was anything to
    check, by which point the command audio itself had already gone
    unstreamed. The leading word of a partial appears within a couple of
    audio chunks of the word actually being spoken, regardless of what
    follows it in the same breath.

    Partials carry no per-word confidence (unlike finals with
    SetWords(True)), so the anti-false-positive job that confidence used to
    do is replaced with a stability requirement instead: the leading word
    must match for `partial_confirm_frames` consecutive chunks (~64ms each)
    before it counts, filtering a one-off misread without waiting for a
    pause. Two things make that requirement itself more forgiving, since a
    partial hypothesis is revisable and can briefly guess wrong before
    settling: the check looks at the first TWO and the last TWO recognized
    words (a stray click/breath can get misheard as a short bogus token
    ahead of "travis" itself, and a hypothesis that keeps growing pushes a
    newly spoken "travis" toward the end), and a single missed frame doesn't reset
    the streak — only two misses in a row do. Firing resets the recognizer
    so the rest of the utterance (the actual command) starts Vosk fresh for
    the *next* wake word rather than re-matching leftovers of this one — it
    does not affect the real command audio, which is streamed to Gemini
    independently of Vosk.
    """

    def __init__(
        self,
        phrase: str,
        sample_rate: int,
        variants: list[str] | None = None,
        partial_confirm_frames: int = 2,
    ):
        import vosk

        vosk.SetLogLevel(
            -1
        )  # Vosk logs to stderr by default; too noisy for our console.
        self._phrase = phrase.strip().lower()
        # A multi-word phrase ("hey travis"): every word but the last must precede
        # the last one, in order. The last word (and its variants) is what the
        # single-word logic below already matches on.
        words = self._phrase.split()
        self._lead_words = words[:-1]
        core = words[-1] if words else self._phrase
        if variants is None:
            variants = _DEFAULT_WAKE_VARIANTS.get(core, [])
        self._match_words = {core, *(v.strip().lower() for v in variants)}
        self._partial_confirm_frames = max(1, partial_confirm_frames)
        self._partial_streak = 0
        self._miss_streak = 0
        self.last_partial = ""  # latest hypothesis, for wake-miss diagnostics
        model = vosk.Model(lang="en-us")  # auto-downloaded/cached on first use (~40MB)
        grammar = [*dict.fromkeys(self._lead_words), *sorted(self._match_words), "[unk]"]
        self._rec = vosk.KaldiRecognizer(model, sample_rate, json.dumps(grammar))

    @property
    def label(self) -> str:
        return self._phrase

    def detect(self, pcm_bytes: bytes) -> bool:
        self._rec.AcceptWaveform(pcm_bytes)  # advances decoder state either way
        partial = json.loads(self._rec.PartialResult()).get("partial", "").strip()
        self.last_partial = partial
        words = partial.lower().split()
        # Check the first TWO and the LAST two recognized words. The first
        # two, not just position 1: a brief click/breath at the start can get
        # misheard as a short stray token ("[unk]") before Vosk's hypothesis
        # resolves onto "travis". The last two because the hypothesis keeps
        # growing while there's continuous sound — Vosk only finalizes on a
        # pause — so a "travis" spoken after other sounds (room noise, "so
        # um…", Travis's own reply being decoded) lands at position 3+ and
        # was never seen: observed live as the decoder hearing
        # '[unk] [unk] travis [unk] travis …' with no wake at all. Newly
        # spoken words always arrive at the tail.
        lead = getattr(self, "_lead_words", None) or []
        if lead:
            # "hey travis": the lead words immediately followed by the wake word,
            # near the start or the end of the hypothesis (same reasoning as above).
            n = len(lead) + 1
            spans = [words[i : i + n] for i in range(len(words) - n + 1)]
            near = spans[:2] + spans[-2:]
            matched = any(sp[:-1] == lead and sp[-1] in self._match_words for sp in near)
        else:
            matched = any(w in self._match_words for w in words[:2] + words[-2:])

        if matched:
            self._partial_streak += 1
            self._miss_streak = 0
        else:
            # Don't wipe the streak on a single flickered miss — a partial
            # hypothesis is revisable, and Vosk can briefly guess wrong in
            # the first instant of a word before settling on the right one
            # as more audio arrives. Only treat it as a genuine miss (and
            # restart counting) after two misses in a row.
            self._miss_streak += 1
            if self._miss_streak >= 2:
                self._partial_streak = 0
                self._miss_streak = 0

        if self._partial_streak >= self._partial_confirm_frames:
            self._partial_streak = 0
            self._miss_streak = 0
            self._rec.Reset()  # start fresh for the next wake word
            return True
        return False
