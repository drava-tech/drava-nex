"""Wake-word lifecycle: load the detector, run it on mic audio, release it."""

from __future__ import annotations

import time


# pyrefly: ignore [missing-import]

from settings import (
    SEND_SAMPLE_RATE, load_api_config,
)
from wake.detectors import OpenWakeWordDetector, VoskWakeWordDetector


class WakeWordMixin:
    """Wake-word lifecycle: load the detector, run it on mic audio, release it."""

    def _init_wake_word(self):
        """Create the configured wake-word detector. Neither engine needs an
        account or API key (unlike Porcupine, whose free tier still requires
        a Picovoice AccessKey). On any failure (package missing, model not
        found/downloadable), log a warning and fall back to always-listening
        behavior rather than refusing to start."""
        try:
            cfg = load_api_config()
            self._awake_timeout = float(cfg.get("awake_timeout_sec", 15.0))
            engine = (cfg.get("wake_word_engine") or "openwakeword").strip().lower()

            if engine == "vosk":
                phrase = cfg.get("wake_word_phrase") or "hey travis"
                variants = cfg.get(
                    "wake_word_variants"
                )  # None => built-in defaults for the phrase
                partial_confirm_frames = int(cfg.get("wake_word_partial_confirm_frames", 1))
                self._wake_model = VoskWakeWordDetector(
                    phrase, SEND_SAMPLE_RATE, variants, partial_confirm_frames
                )
            else:
                configured = cfg.get("wake_word_model") or "hey_jarvis"
                threshold = float(cfg.get("wake_word_threshold", 0.5))
                self._wake_model = OpenWakeWordDetector(configured, threshold)

            print(
                f"[Voice Agent] 🛡️  Wake word active ('{self._wake_model.label}'). "
                f"Standby until addressed (awake window {self._awake_timeout:.0f}s)."
            )
        except Exception as e:
            self._wake_model = None
            self._awake = True  # no detector => behave as before (always listening)
            print(
                f"[Voice Agent] ⚠️ Wake word disabled ({e}). Always-listening fallback."
            )

    def _on_wake(self):
        """A fresh wake word, called on the audio thread just before the
        pre-roll (which holds "Travis") is flushed to _enqueue_out. Nothing
        to do here; TravisLocal resets its VAD."""

    def _release_wake_word(self):
        # openWakeWord's Model holds plain onnxruntime sessions with no
        # explicit teardown API (unlike Porcupine's native handle) — dropping
        # the reference is enough.
        self._wake_model = None

    def _detect_wake_word(self, pcm_bytes: bytes) -> bool:
        """Feed mic PCM to the configured detector (openWakeWord or Vosk).
        Both accept arbitrary-length chunks directly — no manual frame-
        splitting needed here. Returns True if the wake phrase was heard,
        debounced so one spoken wake word can't fire multiple times (see
        _WAKE_DEBOUNCE_SEC)."""
        if self._wake_model is None:
            return False
        if not self._wake_model.detect(pcm_bytes):
            return False
        now = time.monotonic()
        if (
            self._last_wake_detect_at is not None
            and now - self._last_wake_detect_at < self._WAKE_DEBOUNCE_SEC
        ):
            return False
        self._last_wake_detect_at = now
        return True
