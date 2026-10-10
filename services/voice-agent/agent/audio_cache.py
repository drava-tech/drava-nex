"""Pre-rendered speech for the written-down answers (knowledge/faq.yaml, knowledge/smalltalk.yaml).

An answer's audio is stored raw (16-bit mono PCM at the playback rate) in cache/tts/, named by a hash of the exact text, the ElevenLabs voice,
the model and the sample rate: change any of them and the old file is simply not found, so the answer falls back to normal speech until it is
rendered again. tools/render_audio.py writes the files; the agent only reads them.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

CHUNK_BYTES = 8192


def cache_key(text: str, voice_id: str, model_id: str, sample_rate: int) -> str:
    raw = "\n".join([" ".join((text or "").split()), voice_id.strip(), model_id.strip(), str(int(sample_rate))])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:40]


class AudioCache:
    def __init__(self, directory: Path, voice_id: str, model_id: str, sample_rate: int):
        self.dir, self.voice_id, self.model_id, self.sample_rate = Path(directory), voice_id, model_id, int(sample_rate)

    def path(self, text: str) -> Path:
        return self.dir / f"{cache_key(text, self.voice_id, self.model_id, self.sample_rate)}.pcm"

    def has(self, text: str) -> bool:
        p = self.path(text)
        return p.exists() and p.stat().st_size > 0

    def load(self, text: str) -> bytes | None:
        try:
            data = self.path(text).read_bytes()
        except OSError:
            return None
        return data if data and len(data) % 2 == 0 else None

    def store(self, text: str, pcm: bytes) -> Path:
        self.dir.mkdir(parents=True, exist_ok=True)
        p = self.path(text)
        tmp = p.with_suffix(".tmp")
        tmp.write_bytes(pcm)
        tmp.replace(p)
        return p

    @staticmethod
    def chunks(pcm: bytes):
        for i in range(0, len(pcm), CHUNK_BYTES):
            yield pcm[i:i + CHUNK_BYTES]
