"""WebRTC VAD endpointing for the local speech pipeline.

This module decides when the user has finished speaking. It is fed the awake mic stream (arbitrary chunk
sizes of 16 kHz mono int16 PCM) and hands back one complete utterance once
the speaker has gone quiet for `end_ms` — short enough to feel responsive,
long enough not to cut a sentence at a mid-command pause.

Public API:
    Endpointer(...).feed(pcm) -> list[bytes]   finished utterances (0 or 1 usually)
    Endpointer.reset()                          drop everything buffered
"""

from __future__ import annotations

FRAME_MS = 30  # webrtcvad accepts 10/20/30 ms frames only
_TAIL_FRAMES = 200 // FRAME_MS


class Endpointer:
    def __init__(
        self,
        sample_rate: int = 16000,
        aggressiveness: int = 2,
        start_ms: int = 90,
        end_ms: int = 500,
        preroll_ms: int = 300,
        max_ms: int = 12000,
        vad=None,
    ):
        if vad is None:
            # pyrefly: ignore [missing-import]
            import webrtcvad

            vad = webrtcvad.Vad(aggressiveness)
        self._vad = vad
        self._rate = sample_rate
        self._frame_bytes = sample_rate * FRAME_MS // 1000 * 2
        self._start_frames = max(1, start_ms // FRAME_MS)
        self._end_frames = max(1, end_ms // FRAME_MS)
        self._preroll_frames = max(0, preroll_ms // FRAME_MS)
        self._max_frames = max(1, max_ms // FRAME_MS)
        self._pending = b""
        self._clear()

    def reset(self) -> None:
        """Forget the current utterance (and any partial frame)."""
        self._pending = b""
        self._clear()

    def _clear(self) -> None:
        self._frames: list[bytes] = []
        self._voiced_run = 0
        self._silence_run = 0
        self._in_speech = False

    @property
    def in_speech(self) -> bool:
        return self._in_speech

    def feed(self, pcm: bytes) -> list[bytes]:
        out: list[bytes] = []
        data = self._pending + pcm
        usable = len(data) - len(data) % self._frame_bytes
        self._pending = data[usable:]
        for i in range(0, usable, self._frame_bytes):
            frame = data[i : i + self._frame_bytes]
            speech = self._vad.is_speech(frame, self._rate)
            self._frames.append(frame)
            if not self._in_speech:
                self._voiced_run = self._voiced_run + 1 if speech else 0
                if self._voiced_run >= self._start_frames:
                    self._in_speech = True
                    self._silence_run = 0
                else:
                    # Keep only a short lead-in before the speech starts.
                    keep = self._preroll_frames + self._voiced_run
                    if len(self._frames) > keep:
                        del self._frames[: len(self._frames) - keep]
                continue
            self._silence_run = 0 if speech else self._silence_run + 1
            if self._silence_run >= self._end_frames or len(self._frames) >= self._max_frames:
                # Most of the trailing silence adds nothing for the recognizer;
                # a short tail keeps a softly-ended last word intact.
                drop = max(0, self._silence_run - _TAIL_FRAMES)
                spoken = self._frames[: len(self._frames) - drop]
                out.append(b"".join(spoken))
                pending = self._pending
                self._clear()
                self._pending = pending
        return out
