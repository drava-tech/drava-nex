"""Keep the audio of recent utterances, so a mishearing can be replayed against other models/settings.

Without the audio, "it heard 'can you do me a favour'" can't be investigated: only the wrong text
survives. Each utterance is saved as logs/utterances/utt_<ms>.wav and the newest `keep` are retained
(logs/ is gitignored, and the clips are the user's own voice, so they stay on this machine).
"""

from __future__ import annotations

import time
import wave
from pathlib import Path


def save(directory: Path, pcm: bytes, sample_rate: int, keep: int = 200) -> str:
    """Write one 16-bit mono clip; return its file name. Never raises: this must not break a command."""
    try:
        directory.mkdir(parents=True, exist_ok=True)
        name = f"utt_{int(time.time() * 1000)}.wav"
        with wave.open(str(directory / name), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sample_rate)
            w.writeframes(pcm)
        _prune(directory, keep)
        return name
    except OSError:
        return ""


def _prune(directory: Path, keep: int) -> None:
    clips = sorted(directory.glob("utt_*.wav"))  # names sort by time
    for old in clips[: max(0, len(clips) - keep)]:
        try:
            old.unlink()
        except OSError:
            pass
