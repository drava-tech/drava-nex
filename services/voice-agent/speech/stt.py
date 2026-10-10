"""Local speech-to-text for TRAVIS: faster-whisper on the GPU.

Replaces Gemini Live's input transcription. Two passes per utterance:

1. Language detection on the whole utterance. Forcing language="en" makes
   Whisper *translate* other languages into plausible English — a Hindi
   sentence would come out as an English command and run. So the language
   is detected first, and a confidently non-English utterance is rejected
   (TRAVIS only takes English commands; see speech/language_gate.py).
2. Transcription with language="en" (plus hotwords for the room's device
   names) for everything else — including the low-confidence cases, since
   detection is least reliable on short clips and accented English.

Public API:
    decide_language(language_probs, reject_threshold, english_floor) -> str | None
    WhisperSTT(...).transcribe(pcm) -> Transcript
"""

from __future__ import annotations

import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 16000

# What Whisper typically "hears" in noise or a breath (it was trained on
# subtitled video). None of these is a command.
_HALLUCINATIONS = {
    "you", "thank you", "thanks", "thanks for watching", "thank you for watching",
    "thank you very much", "please subscribe", "so", "okay", "hmm", "uh", "um",
}


def looks_like_echo(text: str, seconds: float) -> bool:
    """A transcript that repeats itself or is far longer than the audio could hold.

    With a prompt that lists device names, Whisper sometimes "continues the list" on noisy or
    far-away speech ("Hey Travis. tusker L3, tusker L1, tusker L2, tusker L1, ..."): 17% of
    degraded clips in the benchmark. Speech runs at about 3 words a second, so anything past
    3.5/s + 5 words, or any three-word run repeated 3+ times, is not what was said."""
    words = re.findall(r"[a-z0-9]+", text.lower())
    if len(words) > 3.5 * seconds + 5:
        return True
    grams = [" ".join(words[i : i + 3]) for i in range(len(words) - 2)]
    return any(grams.count(g) >= 3 for g in set(grams))


def _mean_logprob(segments) -> float:
    return sum(s.avg_logprob for s in segments) / len(segments) if segments else 0.0


def _bare(text: str) -> str:
    return re.sub(r"[^a-z ]", "", text.lower()).strip()


@dataclass
class Transcript:
    text: str
    language: str  # detected language code ("en", "hi", ...)
    language_prob: float
    english_prob: float
    # Set when the utterance was confidently not English (text is then "").
    rejected_language: str | None = None
    # Whisper thinks there was no speech at all (noise it would hallucinate on).
    no_speech: bool = False
    ms: float = 0.0
    # The first decode echoed the vocabulary prompt (see looks_like_echo), so this
    # transcript comes from a second decode without it.
    retried_without_prompt: bool = False
    # Mean per-token log-probability Whisper gave its own words (0 = certain, more negative = less sure).
    # Real commands scored -0.05..-0.35 on the user's clips; text it made up from noise scored below -0.5.
    avg_logprob: float = 0.0
    # The first decode was unsure, so the audio was decoded again with the fallback prompt and that
    # transcript (Whisper was more sure of it) is the one returned.
    used_fallback_prompt: bool = False


def decide_language(
    language_probs: list[tuple[str, float]],
    reject_threshold: float = 0.5,
    english_floor: float = 0.15,
) -> str | None:
    """The non-English language to reject, or None to transcribe as English.

    Rejects only when the top guess is another language with at least
    `reject_threshold` probability AND English is below `english_floor` —
    Indian-accented English is sometimes guessed as "hi" at low confidence,
    and a wrongly dropped English command is worse than one more LLM turn.
    """
    if not language_probs:
        return None
    top, top_prob = max(language_probs, key=lambda lp: lp[1])
    if top == "en":
        return None
    english = dict(language_probs).get("en", 0.0)
    if top_prob >= reject_threshold and english < english_floor:
        return top
    return None


def _add_cuda_dirs(extra: str | None) -> None:
    """Make cuBLAS/cuDNN findable before ctranslate2 loads: an explicit folder
    (e.g. a global torch\\lib) and any nvidia-*-cu12 wheels in this venv."""
    if os.name != "nt":
        return
    dirs = []
    if extra:
        dirs.append(Path(extra))
    site = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia"
    if site.is_dir():
        dirs.extend(p / "bin" for p in site.iterdir() if (p / "bin").is_dir())
    for d in dirs:
        if d.is_dir():
            os.add_dll_directory(str(d))
            os.environ["PATH"] = str(d) + os.pathsep + os.environ.get("PATH", "")


class WhisperSTT:
    def __init__(
        self,
        model: str = "small",
        device: str = "cuda",
        compute_type: str = "float16",
        hotwords: str = "",
        initial_prompt: str = "",
        cuda_lib_dir: str | None = None,
        beam_size: int = 1,
        reject_threshold: float = 0.5,
        english_floor: float = 0.15,
        single_pass: bool = True,
        fallback_prompt: str = "",
        retry_below: float | None = -0.30,
    ):
        _add_cuda_dirs(cuda_lib_dir)
        # pyrefly: ignore [missing-import]
        from faster_whisper import WhisperModel

        try:
            self._model = WhisperModel(model, device=device, compute_type=compute_type)
            self.device = device
        except Exception as e:
            if device == "cpu":
                raise
            print(f"[STT] ⚠️ {device} unavailable ({e}) — falling back to CPU int8 (slower).")
            self._model = WhisperModel(model, device="cpu", compute_type="int8")
            self.device = "cpu"
        self._hotwords = hotwords or None
        self._initial_prompt = initial_prompt or None
        self._beam_size = beam_size
        self._reject_threshold = reject_threshold
        self._english_floor = english_floor
        self._single_pass = single_pass
        # A command-shaped prompt is best for commands but drags short replies ("Hi", "tusker edge")
        # and chatter towards commands. When its decode is unsure, the audio is decoded once more
        # with this plainer prompt and the transcript Whisper is more sure of wins.
        self._fallback_prompt = fallback_prompt or None
        self._retry_below = retry_below
        # Warm-up so the first real command doesn't pay CUDA/kernel init.
        import numpy as np

        self._model.transcribe(np.zeros(SAMPLE_RATE, dtype=np.float32), language="en")

    def warm(self) -> None:
        """A short silent clip through language detection and a decode: wakes an idle GPU and keeps
        the kernels hot. Called on the wake word, so it overlaps with the user speaking."""
        import numpy as np

        audio = np.zeros(SAMPLE_RATE // 2, dtype=np.float32)
        try:
            self._model.detect_language(audio)
            list(self._model.transcribe(audio, language="en", beam_size=1, temperature=0.0, max_new_tokens=1,
                                        without_timestamps=True, vad_filter=False)[0])
        except Exception as e:  # a failed warm-up must never take the agent down
            print(f"[STT] warm-up skipped: {e}")

    def transcribe(self, pcm: bytes) -> Transcript:
        import numpy as np

        started = time.monotonic()
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        if audio.size == 0:
            return Transcript("", "en", 0.0, 0.0, no_speech=True)

        seconds = audio.size / SAMPLE_RATE
        if self._single_pass:
            # One encoder pass instead of two: the language is detected as part of the decode
            # (language=None) rather than by a separate detect_language() that runs the whole encoder
            # first. The encoder is most of a large model's time, so this halves it. English (nearly
            # always) keeps that decode; only an ambiguous guess pays for a second, forced-English one.
            segments, text, info = self._decode(audio, seconds, with_vocabulary=True, language=None)
            language, language_prob = info.language, float(info.language_probability)
            probs = list(getattr(info, "all_language_probs", None) or [(language, language_prob)])
        else:
            language, language_prob, probs = self._model.detect_language(audio)
        english = dict(probs).get("en", 0.0)
        rejected = decide_language(probs, self._reject_threshold, self._english_floor)
        if rejected:
            return Transcript(
                "", language, language_prob, english, rejected_language=rejected,
                ms=(time.monotonic() - started) * 1000,
            )
        if not self._single_pass or language != "en":
            # Transcribe as English, including the low-confidence cases: detection is least reliable
            # on short clips and accented English (Indian-accented English is sometimes guessed "hi").
            segments, text, _ = self._decode(audio, seconds, with_vocabulary=True)
        used_fallback = False
        if self._fallback_prompt and self._retry_below is not None and segments and _mean_logprob(segments) < self._retry_below:
            alt_segments, alt_text, _ = self._decode(audio, seconds, with_vocabulary=True, prompt=self._fallback_prompt)
            if alt_segments and _mean_logprob(alt_segments) > _mean_logprob(segments):
                segments, text, used_fallback = alt_segments, alt_text, True
        retried = False
        if looks_like_echo(text, seconds) and (self._initial_prompt or self._hotwords):
            segments, text, _ = self._decode(audio, seconds, with_vocabulary=False)
            retried = True
            if looks_like_echo(text, seconds):
                segments, text = [], ""  # still not speech: treat as noise
        # Whisper invents text for noise ("you", "Thank you."): trust its own
        # no-speech estimate when the decode was also unsure of itself, and
        # never pass on its stock hallucinations from a short clip.
        no_speech = not segments or all(
            s.no_speech_prob > 0.6 and s.avg_logprob < -1.0 for s in segments
        )
        if _bare(text) in _HALLUCINATIONS and audio.size < SAMPLE_RATE * 3:
            no_speech = True
        return Transcript(
            "" if no_speech else text,
            language,
            language_prob,
            english,
            no_speech=no_speech,
            ms=(time.monotonic() - started) * 1000,
            retried_without_prompt=retried,
            avg_logprob=_mean_logprob(segments),
            used_fallback_prompt=used_fallback,
        )

    def _decode(self, audio, seconds: float, with_vocabulary: bool, language: str | None = "en", prompt: str | None = None):
        segments, info = self._model.transcribe(
            audio,
            language=language,
            beam_size=self._beam_size,
            hotwords=self._hotwords if with_vocabulary else None,
            initial_prompt=(prompt or self._initial_prompt) if with_vocabulary else None,
            vad_filter=False,  # already cut by WebRTC VAD
            condition_on_previous_text=False,
            without_timestamps=True,
            # One greedy pass. The default retries at rising temperatures
            # whenever a decode looks unsure — on noise that's 3-4 extra
            # decodes (~600ms instead of ~150ms) to produce garbage anyway.
            temperature=0.0,
            # A runaway can't cost more than a sentence of this length.
            max_new_tokens=int(24 + 10 * seconds),
        )
        segments = list(segments)
        return segments, " ".join(seg.text.strip() for seg in segments).strip(), info
