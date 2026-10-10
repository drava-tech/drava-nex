"""End-of-speech detection that understands whether the sentence is finished (config `endpointing: "smart"`).

The old endpointer (speech/vad.py, `endpointing: "webrtc"`, the default) waits for a fixed stretch of unbroken silence.
That costs the whole timeout on every command, and in a noisy room the silence never comes. This one:

  1. Silero VAD finds speech and short pauses (frames of 32 ms).
  2. On a pause of `endpoint_pause_ms` it asks Smart Turn (speech/smart_turn.py) whether the turn is complete. Complete: the
     utterance ends at once. Not complete: keep listening (re-asking every `smart_turn_recheck_ms`) for up to
     `endpoint_grace_ms` of silence. `in_speech` stays True the whole time, so Travis never interrupts a pause with
     "what do you need?".
  3. Noise that the VAD calls speech must not keep the mic open forever. On real recordings Silero already sees the pauses in
     room noise, so by default only a last resort is on: the loudness gate (frames more than `endpoint_gate_db` below the
     utterance's own loud speech count as silence) ends the utterance after `endpoint_gate_end_ms` of that. Two optional,
     off-by-default triggers also ask Smart Turn when the VAD sees no pause (they cut real commands in testing):
       - `endpoint_interval_ms` (with `endpoint_interval_after_ms`, `endpoint_interval_threshold`): ask every so often;
       - `endpoint_gate_pause_ms` (with `endpoint_gate_threshold`): ask when the gate reports a pause.
  4. `endpoint_max_ms` is a hard cap on the whole utterance.

The audio handed on is the utterance (with `endpoint_preroll_ms` before the speech and ~200 ms after the last voiced frame).
Interface = speech.vad.Endpointer: feed(pcm bytes) -> list[bytes], reset(), in_speech; plus `last_reason` / `stats`.
"""

from __future__ import annotations

import time
from collections import Counter, deque
from pathlib import Path

import numpy as np

from speech.silero_vad import FRAME, SileroVAD
from speech.smart_turn import SmartTurn

FRAME_MS = FRAME * 1000 // 16000  # 32


def _ms_to_frames(ms: float) -> int:
    return max(1, int(round(ms / FRAME_MS)))


class SmartEndpointer:
    def __init__(
        self,
        vad,
        turn,
        *,
        start_ms: float = 96,
        preroll_ms: float = 300,
        tail_ms: float = 200,
        pause_ms: float = 450,
        grace_ms: float = 3000,
        max_ms: float = 10000,
        speech_threshold: float = 0.5,
        silence_threshold: float = 0.35,
        turn_threshold: float = 0.5,
        recheck_ms: float = 300,
        interval_ms: float | None = None,
        interval_after_ms: float = 1200,
        interval_threshold: float = 0.9,
        gate_db: float | None = 18.0,
        gate_pause_ms: float | None = None,
        gate_end_ms: float = 3000,
        gate_threshold: float = 0.9,
    ):
        self._vad = vad
        self._turn = turn
        self._start = _ms_to_frames(start_ms)
        self._preroll = _ms_to_frames(preroll_ms)
        self._tail = _ms_to_frames(tail_ms)
        self._pause = _ms_to_frames(pause_ms)
        self._grace = _ms_to_frames(grace_ms)
        self._max = _ms_to_frames(max_ms)
        self._on, self._off = speech_threshold, silence_threshold
        self._turn_threshold = turn_threshold
        self._recheck = _ms_to_frames(recheck_ms)
        self._interval = _ms_to_frames(interval_ms) if interval_ms else 0
        self._interval_after = _ms_to_frames(interval_after_ms)
        self._interval_threshold = interval_threshold
        self._gate_db = gate_db
        self._gate_pause = _ms_to_frames(gate_pause_ms) if gate_pause_ms else 0
        self._gate_end = _ms_to_frames(gate_end_ms)
        self._gate_threshold = gate_threshold
        self.stats: Counter = Counter()  # how many utterances each trigger has ended
        self.turn_calls = 0
        self.turn_ms = 0.0
        self.last_reason: str | None = None
        self.last_turn_prob: float | None = None  # Smart Turn's verdict behind the last ending (None: it was not asked)
        self.reset()

    # ── state ───────────────────────────────────────────────────────────
    def reset(self) -> None:
        """Forget the current utterance (and any partial frame)."""
        self._vad.reset()
        self._pending = b""
        self._clear()

    def _clear(self) -> None:
        self._ring: deque = deque(maxlen=self._preroll + self._start)
        self._voiced_run = 0
        self._in_speech = False
        self._frames: list[np.ndarray] = []
        self._voiced = False
        self._last_voiced = 0
        self._levels: deque = deque(maxlen=200)  # dB of the frames that were confidently speech
        self._gate_run = 0
        self._last_check = -10**9
        self._cache: tuple[int, float] | None = None

    @property
    def in_speech(self) -> bool:
        return self._in_speech

    # ── input ───────────────────────────────────────────────────────────
    def feed(self, pcm: bytes) -> list[bytes]:
        out: list[bytes] = []
        data = self._pending + pcm
        step = FRAME * 2
        usable = len(data) - len(data) % step
        self._pending = data[usable:]
        for i in range(0, usable, step):
            utterance = self._frame(np.frombuffer(data[i:i + step], dtype=np.int16))
            if utterance is not None:
                out.append(utterance)
                pending = self._pending
                self._vad.reset()
                self._clear()
                self._pending = pending
                break  # like the old endpointer: the rest of this chunk is not a new utterance
        return out

    def _frame(self, frame: np.ndarray) -> bytes | None:
        p = self._vad.prob(frame)
        if not self._in_speech:
            self._ring.append(frame)
            self._voiced_run = self._voiced_run + 1 if p >= self._on else 0
            if self._voiced_run >= self._start:
                self._in_speech = True
                self._frames = list(self._ring)
                self._voiced = True
                self._last_voiced = len(self._frames) - 1
            return None

        self._frames.append(frame)
        idx = len(self._frames) - 1
        if p >= self._on:
            self._voiced = True
        elif p < self._off:
            self._voiced = False
        if self._voiced:
            self._last_voiced = idx
        silence = idx - self._last_voiced  # frames since the VAD last heard speech

        if p >= self._on:
            self._levels.append(self._db(frame))
        quiet_vs_speech = False
        if self._gate_db is not None and len(self._levels) >= 3:
            quiet_vs_speech = self._db(frame) < float(np.percentile(self._levels, 95)) - self._gate_db
        self._gate_run = self._gate_run + 1 if quiet_vs_speech else 0

        n = len(self._frames)
        if n >= self._max:
            return self._finish("cap")
        # 1. a pause the VAD sees
        if silence >= self._pause:
            if idx - self._last_check >= self._recheck and self._turn_prob(idx) >= self._turn_threshold:
                return self._finish("pause")
            if silence >= self._grace:
                return self._finish("grace")
        # 2. a pause only the loudness gate sees (the VAD still hears "speech" in the noise)
        if self._gate_db is not None:
            if self._gate_pause and self._gate_run >= self._gate_pause:
                if idx - self._last_check >= self._recheck and self._turn_prob(idx) >= self._gate_threshold:
                    return self._finish("gate")
            if self._gate_run >= self._gate_end:
                return self._finish("gate-fallback")  # the VAD never saw the pause; the user has been quiet for this long
        # 3. speech that just goes on: look every so often anyway
        if self._interval and n >= self._interval_after and idx - self._last_check >= self._interval:
            if self._turn_prob(idx) >= self._interval_threshold:
                return self._finish("interval")
        return None

    @staticmethod
    def _db(frame: np.ndarray) -> float:
        x = frame.astype(np.float64) / 32768.0
        return float(20 * np.log10(np.sqrt(np.mean(x * x)) + 1e-9))

    def _turn_prob(self, idx: int) -> float:
        """Smart Turn on everything heard so far in this utterance (once per frame, however many triggers ask)."""
        if self._cache is not None and self._cache[0] == idx:
            return self._cache[1]
        t0 = time.perf_counter()
        p = self._turn.prob(np.concatenate(self._frames))
        self.turn_ms += (time.perf_counter() - t0) * 1000
        self.turn_calls += 1
        self._last_check = idx
        self._cache = (idx, p)
        self.last_turn_prob = p
        return p

    def _finish(self, reason: str) -> bytes:
        keep = min(len(self._frames), self._last_voiced + 1 + self._tail)
        self.last_reason = reason
        self.stats[reason] += 1
        return np.concatenate(self._frames[:keep]).tobytes()


def make_endpointer(cfg: dict, sample_rate: int = 16000):
    """The endpointer config asks for (`endpointing`): "webrtc" (default, speech/vad.py) or "smart".
    Falls back to the old one, with a warning, if the smart one's models are missing or fail to load."""
    from settings import BASE_DIR
    from speech.vad import Endpointer

    def old() -> Endpointer:
        return Endpointer(
            sample_rate=sample_rate,
            aggressiveness=int(cfg.get("vad_aggressiveness", 2)),
            end_ms=int(cfg.get("vad_end_silence_ms", 500)),
            max_ms=int(cfg.get("vad_max_utterance_ms", 12000)),
        )

    if str(cfg.get("endpointing", "webrtc")).lower() != "smart":
        return old()
    models = Path(cfg.get("endpoint_models_dir") or BASE_DIR / "audio" / "models")
    try:
        gate = cfg.get("endpoint_gate_db", 18.0)
        endpointer = SmartEndpointer(
            SileroVAD(models / "silero_vad.onnx", sample_rate),
            SmartTurn(models / "smart-turn-v3.2-cpu.onnx"),
            start_ms=float(cfg.get("endpoint_start_ms", 96)),
            preroll_ms=float(cfg.get("endpoint_preroll_ms", 300)),
            pause_ms=float(cfg.get("endpoint_pause_ms", 450)),
            grace_ms=float(cfg.get("endpoint_grace_ms", 3000)),
            max_ms=float(cfg.get("endpoint_max_ms", 10000)),
            speech_threshold=float(cfg.get("silero_threshold", 0.5)),
            silence_threshold=float(cfg.get("silero_neg_threshold", 0.35)),
            turn_threshold=float(cfg.get("smart_turn_threshold", 0.5)),
            recheck_ms=float(cfg.get("smart_turn_recheck_ms", 300)),
            interval_ms=float(cfg.get("endpoint_interval_ms") or 0) or None,
            interval_after_ms=float(cfg.get("endpoint_interval_after_ms", 1200)),
            interval_threshold=float(cfg.get("endpoint_interval_threshold", 0.9)),
            gate_db=None if gate in (None, 0, False) else float(gate),
            gate_pause_ms=float(cfg.get("endpoint_gate_pause_ms") or 0) or None,
            gate_end_ms=float(cfg.get("endpoint_gate_end_ms", 3000)),
            gate_threshold=float(cfg.get("endpoint_gate_threshold", 0.9)),
        )
        print("[Voice Agent] 🎚️ End-of-speech: Silero VAD + Smart Turn.")
        return endpointer
    except Exception as e:
        print(f"[Voice Agent] ⚠️ Smart end-of-speech unavailable ({e}); using the WebRTC endpointer.")
        return old()
