"""Cheap capture-side measurements: level, clipping, noise floor, overruns, stalls.

Measure only — nothing here changes the audio. The live mic callback and
bench/audio_probe.py share it, so "what the room sounds like" is read the
same way in both. Every figure is per 16 kHz mono int16 chunk.
"""

from __future__ import annotations

import collections
import time
from dataclasses import dataclass, field

import numpy as np

CLIP_LEVEL = 32000  # int16 samples at/above this magnitude count as clipped
FLOOR_WINDOW = 160  # chunks (~10 s at 64 ms) the noise floor is estimated over
FLOOR_PERCENTILE = 10  # the quietest 10% of chunks ~ the room with nobody talking


def dbfs(level: float) -> float:
    """Linear 0..1 level -> dBFS (floor of -120 for silence)."""
    return 20.0 * float(np.log10(max(level, 1e-6)))


@dataclass
class ChunkLevel:
    rms: float  # 0..1
    peak: float  # 0..1
    clipped: int  # samples at/above CLIP_LEVEL
    dc: float  # mean sample value, 0..1 (a large offset = a broken input path)


def measure_chunk(pcm: bytes) -> ChunkLevel:
    s = np.frombuffer(pcm, dtype=np.int16)
    if s.size == 0:
        return ChunkLevel(0.0, 0.0, 0, 0.0)
    f = s.astype(np.float32) / 32768.0
    return ChunkLevel(
        rms=float(np.sqrt(np.mean(f * f))),
        peak=float(np.max(np.abs(f))),
        clipped=int(np.count_nonzero(np.abs(s.astype(np.int32)) >= CLIP_LEVEL)),
        dc=float(abs(np.mean(f))),
    )


@dataclass
class CaptureMeter:
    """Running stats for one open input stream. Feed it from the audio callback."""

    chunk_samples: int = 1024
    sample_rate: int = 16000
    chunks: int = 0
    overflows: int = 0  # PortAudio input_overflow flags (a chunk was lost)
    other_status: int = 0  # any other non-zero callback status
    clipped_chunks: int = 0
    clipped_samples: int = 0
    silent_chunks: int = 0  # digital silence: exact zeros = muted / dead path
    last_chunk_at: float | None = None
    last_signal_at: float | None = None  # last chunk that wasn't all zeros
    max_gap_s: float = 0.0
    _rms: collections.deque = field(default_factory=lambda: collections.deque(maxlen=FLOOR_WINDOW))
    peak: float = 0.0
    last_rms: float = 0.0

    def feed(self, pcm: bytes, status=None, now: float | None = None) -> ChunkLevel:
        now = time.monotonic() if now is None else now
        lvl = measure_chunk(pcm)
        self.chunks += 1
        if status:
            if getattr(status, "input_overflow", False):
                self.overflows += 1
            else:
                self.other_status += 1
        if lvl.clipped:
            self.clipped_chunks += 1
            self.clipped_samples += lvl.clipped
        if lvl.peak == 0.0:
            self.silent_chunks += 1
        else:
            self.last_signal_at = now
        if self.last_signal_at is None:
            self.last_signal_at = now  # a stream that starts out silent counts from its first chunk
        if self.last_chunk_at is not None:
            self.max_gap_s = max(self.max_gap_s, now - self.last_chunk_at)
        self.last_chunk_at = now
        self.peak = max(self.peak, lvl.peak)
        self.last_rms = lvl.rms
        self._rms.append(lvl.rms)
        return lvl

    def noise_floor(self) -> float:
        """Level of the room between utterances (None-safe: 0.0 before any audio)."""
        if not self._rms:
            return 0.0
        return float(np.percentile(np.fromiter(self._rms, dtype=np.float32), FLOOR_PERCENTILE))

    def seconds_since_chunk(self, now: float | None = None) -> float:
        """How long the stream has been quiet in the *callback* sense (a stall)."""
        if self.last_chunk_at is None:
            return 0.0
        return (time.monotonic() if now is None else now) - self.last_chunk_at

    def seconds_dead(self, now: float | None = None) -> float:
        """How long the input has been exactly zero (0.0 while there is any signal)."""
        if self.last_signal_at is None:
            return 0.0
        return (time.monotonic() if now is None else now) - self.last_signal_at

    def dead_input(self, now: float | None = None, after_s: float = 3.0) -> bool:
        """Digital silence for `after_s` — a muted/disconnected path, not a quiet room
        (a live mic always has some noise, so its samples are never all zero)."""
        return self.seconds_dead(now) >= after_s

    def reset_counters(self) -> None:
        """Start a new reporting window; the noise floor history is kept."""
        self.overflows = self.other_status = 0
        self.clipped_chunks = self.clipped_samples = 0
        self.max_gap_s = 0.0
        self.peak = 0.0

    def problems(self) -> list[str]:
        out = []
        if self.overflows:
            out.append(f"{self.overflows} input overflows (dropped audio)")
        if self.other_status:
            out.append(f"{self.other_status} other stream errors")
        if self.clipped_chunks:
            out.append(f"clipping in {self.clipped_chunks} chunks ({self.clipped_samples} samples)")
        if self.max_gap_s > 0.5:
            out.append(f"longest callback gap {self.max_gap_s:.2f}s")
        return out

    def summary(self) -> str:
        return (
            f"{self.chunks} chunks, floor {dbfs(self.noise_floor()):.0f} dBFS, "
            f"peak {dbfs(self.peak):.0f} dBFS, overflows {self.overflows}, "
            f"clipped chunks {self.clipped_chunks}, max gap {self.max_gap_s:.2f}s"
        )


def echo_tail_seconds(after: list[tuple[float, float]], t_end: float, floor: float, factor: float = 2.0) -> float | None:
    """How long after playback stopped the mic still hears it.

    `after` is (time, rms) per capture chunk after playback ended. The tail ends at the
    first moment two consecutive chunks are back within `factor` x the noise floor.
    None = never settled inside the window."""
    limit = max(floor * factor, 1e-4)
    run = 0
    for t, rms in after:
        if rms <= limit:
            run += 1
            if run == 2:
                return t - t_end
        else:
            run = 0
    return None
