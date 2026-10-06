"""Optional target-speaker gate: only the person who woke TRAVIS gets through."""

from __future__ import annotations

import os
import queue
import threading
import time


# pyrefly: ignore [missing-import]

from settings import (
    SEND_SAMPLE_RATE, load_api_config,
)


class SpeakerGateMixin:
    """Optional target-speaker gate: only the person who woke TRAVIS gets through."""

    # ── Target-speaker extraction ────────────────────────────────────────
    def _init_speaker_extraction(self):
        """Enable continuous target-speaker extraction if opted in and the
        model loads. Unlike the old speaker gate, this never hard-drops
        audio — it only scales it, so it can't block or delay command
        capture waiting on a verification decision."""
        try:
            cfg = load_api_config()
            if not bool(
                cfg.get(
                    "speaker_extraction_enabled", cfg.get("speaker_gate_enabled", False)
                )
            ):
                return
            self._extract_threshold = float(cfg.get("speaker_match_threshold", 0.65))
            self._extract_window_sec = float(
                cfg.get("speaker_extraction_window_sec", 0.45)
            )
            self._extract_hop_sec = float(cfg.get("speaker_extraction_hop_sec", 0.15))
            self._extract_adapt_margin = float(cfg.get("speaker_adapt_margin", 0.12))
            # Was a hardcoded 0.015 in audio/speaker.py — too high for a mic
            # quieter than whatever it was originally tuned against, which
            # silently made every embed() call return None (see speaker.py's
            # embed() docstring). Configurable now so it can be tuned without
            # a code change; default lowered from the old hardcoded value.
            self._extract_min_rms = float(cfg.get("speaker_min_rms", 0.008))

            from audio import speaker

            if not speaker.available():
                print(
                    "[Voice Agent] ⚠️ Target-speaker extraction enabled but model "
                    "unavailable (pip install resemblyzer). Streaming all awake audio."
                )
                return

            # Experimental (2026-09-22 research spike): a GPU source-
            # separation backend as an alternative to the CPU Resemblyzer
            # gain gate above — see audio/target_speaker_gpu.py for why and
            # its caveats. OFF unless explicitly opted into in config;
            # any load/inference failure falls straight back to the
            # Resemblyzer path below, never blocks startup.
            self._extract_backend = str(
                cfg.get("speaker_extraction_backend", "resemblyzer")
            ).strip().lower()
            if self._extract_backend == "gpu_separation_experimental":
                try:
                    from audio import target_speaker_gpu

                    if not target_speaker_gpu.available():
                        print(
                            "[Voice Agent] ⚠️ speaker_extraction_backend="
                            "gpu_separation_experimental but CUDA/model load "
                            "failed — falling back to the Resemblyzer gate."
                        )
                        self._extract_backend = "resemblyzer"
                    else:
                        print(
                            "[Voice Agent] 🧪 Experimental GPU target-speaker "
                            "extraction backend active."
                        )
                except Exception as e:
                    print(
                        f"[Voice Agent] ⚠️ GPU extraction backend unavailable "
                        f"({e}) — falling back to the Resemblyzer gate."
                    )
                    self._extract_backend = "resemblyzer"

            self._extract_q = queue.Queue(maxsize=256)
            self._extract_active = True
            threading.Thread(
                target=self._speaker_extraction_worker,
                name="speaker-extraction",
                daemon=True,
            ).start()
            print(
                f"[Voice Agent] 🎯 Target-speaker extraction active (threshold "
                f"{self._extract_threshold:.2f}, {self._extract_window_sec * 1000:.0f}ms "
                f"window / {self._extract_hop_sec * 1000:.0f}ms hop). Cross-talk is "
                "continuously suppressed, not blocked."
            )
        except Exception as e:
            self._extract_active = False
            print(
                f"[Voice Agent] ⚠️ Target-speaker extraction disabled ({e}). "
                "Streaming all awake audio."
            )

    def _enroll_target(self, pcm: bytes):
        """Capture the waker's reference voice embedding from recent audio."""
        from audio import speaker

        self._timing.setdefault(
            "target_speaker_reference_started", time.monotonic()
        )
        emb = speaker.embed(pcm, SEND_SAMPLE_RATE, min_rms=self._extract_min_rms)
        if emb is not None:
            self._target_embed = emb
            self._extract_gain_target = 1.0
            self._extract_gain_applied = 1.0
            self._timing.setdefault(
                "target_speaker_reference_created", time.monotonic()
            )
            print(
                "[Voice Agent] 🎯 Target-speaker reference created — "
                "extracting continuously."
            )

    def _speaker_extraction_worker(self):
        """Consume raw awake audio, maintain a rolling analysis window, and
        every hop re-estimate how well it matches the enrolled target —
        updating a continuous gain the audio thread applies to every chunk
        it forwards. This worker never decides WHETHER to forward audio,
        only how loud it should be; the mic callback always sends every
        chunk (see the "Stream to Gemini" block), so analysis running
        behind (a slow embed() call) delays a gain UPDATE, never audio
        itself — the send path never waits on this thread."""
        from audio import speaker

        rolling = bytearray()
        window_bytes = int(self._extract_window_sec * SEND_SAMPLE_RATE) * 2  # int16
        hop_bytes = int(self._extract_hop_sec * SEND_SAMPLE_RATE) * 2
        since_hop = 0
        # Resemblyzer's own floor (audio/speaker.py's _MIN_SECONDS) — below
        # this, embed() always returns None regardless of window_bytes, so
        # don't even bother calling it.
        min_window_bytes = int(0.4 * SEND_SAMPLE_RATE) * 2
        # Safety valve: if the target hasn't matched well for this many
        # consecutive hops (~= one full awake window), assume enrollment
        # went bad (not "the room got noisy for a moment") and stop
        # suppressing, rather than leaving TRAVIS deaf to everyone for the
        # rest of the exchange.
        max_low_streak = max(4, int(self._awake_timeout / self._extract_hop_sec))
        low_streak = 0

        while True:
            kind, pcm = self._extract_q.get()
            if kind == "wake":
                self._enroll_target(pcm)
                rolling = bytearray()
                since_hop = 0
                low_streak = 0
                continue

            rolling.extend(pcm)
            since_hop += len(pcm)
            if len(rolling) > window_bytes:
                del rolling[: len(rolling) - window_bytes]
            if since_hop < hop_bytes:
                continue
            since_hop = 0

            target = self._target_embed
            if target is None or len(rolling) < min_window_bytes:
                # No reference yet, or not enough audio buffered for a real
                # embedding — stay fully open rather than guess.
                self._extract_gain_target = 1.0
                continue

            if self._extract_backend == "gpu_separation_experimental":
                from audio import target_speaker_gpu

                gpu_pcm, gpu_score, gpu_ms = target_speaker_gpu.extract(
                    bytes(rolling), SEND_SAMPLE_RATE, target
                )
                if os.getenv("TRAVIS_DEBUG_WAKE") == "1":
                    print(f"[Voice Agent] 🧪 GPU extract took {gpu_ms:.0f}ms")
                if gpu_pcm is None:
                    # Per-chunk fallback (not just at startup): CUDA/model
                    # inference failed, or this window was unusable for it —
                    # judge this hop the same way the CPU-only path always
                    # has rather than leaving it ungated.
                    emb = speaker.embed(
                        bytes(rolling), SEND_SAMPLE_RATE, min_rms=self._extract_min_rms
                    )
                    if emb is None:
                        continue
                    score = speaker.cosine(emb, target)
                else:
                    score = gpu_score
                    # Re-embed the extracted (cleaner) audio, not the raw
                    # mix, so target-embedding adaptation below tracks the
                    # separated voice — cheap relative to the GPU pass this
                    # already did to pick a winning candidate.
                    emb = speaker.embed(gpu_pcm, SEND_SAMPLE_RATE, min_rms=0.0)
                    if emb is None:
                        emb = target
            else:
                emb = speaker.embed(
                    bytes(rolling), SEND_SAMPLE_RATE, min_rms=self._extract_min_rms
                )
                if emb is None:
                    # Window too quiet to judge (silence/near-silence): hold
                    # the last gain estimate rather than snap it anywhere —
                    # near-silent audio sounds the same whatever it's
                    # multiplied by.
                    continue
                score = speaker.cosine(emb, target)
            # Easier to pass while TRAVIS is speaking (barge-in): the user's
            # real voice is partly masked by echo then, so it needs a lower
            # bar to still read as a match. Pure TTS echo scores far below
            # even this relaxed bar against a human target voiceprint.
            center = self._extract_threshold - (0.10 if self._is_speaking else 0.0)
            # Soft ramp, not a cliff: fully open ~0.05 above center, fully
            # suppressed ~0.15 below it, linear in between — a borderline
            # score fades rather than flips.
            low, high = center - 0.15, center + 0.05
            gain = (
                0.0
                if score <= low
                else 1.0 if score >= high else (score - low) / (high - low)
            )
            # Never fully mute: a hard 0 sounds identical to a dropped
            # connection, and this is suppression, not authorization.
            gain = max(0.03, gain)
            self._extract_gain_target = gain

            if gain >= 0.6:
                low_streak = 0
                if score >= self._extract_threshold + self._extract_adapt_margin:
                    self._target_embed = speaker.blend(target, emb, weight=0.1)
            else:
                low_streak += 1
                if low_streak >= max_low_streak:
                    label = (
                        self._wake_model.label if self._wake_model else "the wake word"
                    )
                    print(
                        "[Voice Agent] 🔓 Target-speaker extraction: no match "
                        f"for a while — opening back up until next '{label}'."
                    )
                    self._target_embed = None
                    self._extract_gain_target = 1.0
                    low_streak = 0

            print(f"[Voice Agent] 🎯 extract: gain={gain:.2f} (score={score:.2f})")
