"""The exchange state machine: when the mic closes, nudges, standby, timing report."""

from __future__ import annotations

import time


# pyrefly: ignore [missing-import]



class ExchangeStateMixin:
    """The exchange state machine: when the mic closes, nudges, standby, timing report."""

    # After "Travis", how long the room may stay silent before Travis asks
    # what the user wants.
    _NUDGE_AFTER_SEC = 2.0

    _NUDGE_TEXT = (
        "[NUDGE] The user just said your name but hasn't asked for anything "
        "yet. In one short sentence, ask what they'd like."
    )

    # After a reply is complete, how long everything must stay quiet
    # (no new audio, no tool call, nothing playing) before the mic closes.
    _REPLY_GRACE_SEC = 1.0

    # A request still being worked on may run this long past awake_timeout_sec
    # before the mic is closed on it anyway (a lost turn_complete must not
    # leave the mic open forever).
    _EXCHANGE_HARD_CAP_SEC = 30.0

    def _on_model_activity(self):
        """Travis spoke or ran a tool: a request is being answered."""
        self._last_model_activity = time.monotonic()
        if self._awake:
            self._exchange_active = True
        # First sign of a response this exchange (once per wake word).
        self._timing.setdefault("model_response_started", self._last_model_activity)

    # Named per-exchange latency stages, wake word -> first audible sound.
    # Reset to {"wake_detected": ...} on every fresh wake word (see the mic
    # callback's wake-engaged block) and printed once, the first time audio
    # actually reaches the speaker (see _play_audio's playback_started hook).
    _TIMING_STAGES = [
        ("wake_detected", "wake_detected"),
        ("command_mode_started", "command_mode_started"),
        ("preroll_flush_started", "preroll_flush_started"),
        ("preroll_flush_completed", "preroll_flush_completed"),
        ("target_speaker_reference_started", "target_speaker_reference_started"),
        ("target_speaker_reference_created", "target_speaker_reference_created"),
        ("first_extracted_chunk_sent", "first_extracted_chunk_sent"),
        ("vad_speech_end", "vad_speech_end (approx*)"),
        ("model_response_started", "model_response_started"),
        ("cms_request_started", "cms_request_started"),
        ("cms_response_received", "cms_response_received"),
        ("first_audio_chunk_received", "elevenlabs_first_audio_received"),
        ("playback_started", "playback_started"),
    ]

    def _print_timing_report(self):
        """Print how long each stage of the current exchange took, from wake
        word to first audible sound. *Gemini Live streams continuously rather
        than one request per turn (no discrete per-turn "request"), so
        vad_speech_end is approximated from the last transcript chunk it
        streams back rather than a clean end-of-speech event."""
        t = self._timing
        if "wake_detected" not in t:
            return
        base = t["wake_detected"]
        print("[Voice Agent] ⏱️  ── Exchange timing (wake word → first sound) ──")
        prev = None
        for key, label in self._TIMING_STAGES:
            val = t.get(key)
            if val is None:
                print(f"[Voice Agent]     {label:<32} —")
                continue
            since_start = (val - base) * 1000
            step = f" (+{(val - prev) * 1000:.0f}ms)" if prev is not None else ""
            print(f"[Voice Agent]     {label:<32} {since_start:7.0f}ms{step}")
            prev = val
        if "playback_started" in t:
            print(
                f"[Voice Agent]     Total (wake word to first sound): "
                f"{(t['playback_started'] - base) * 1000:.0f}ms"
            )

    def _awake_action(self, now: float, busy: bool) -> str | None:
        """What the awake mic should do right now: None (keep listening),
        "nudge" (ask what the user wants), "wait_for_command" (the nudge has
        been spoken; keep the mic open for the real request) or "standby".

        The mic closes only once the WHOLE exchange is finished — Gemini has
        said the turn is complete, every tool call has run and been answered,
        and the audio has finished playing — never on a mere gap in playback.
        A reply that gets cut off (interrupted) or a second command that
        starts more work reopens "not finished" and so keeps the mic open.
        `busy` = Travis is speaking, a tool is running, or audio is queued."""
        if not self._awake or self._wake_model is None:
            return None

        if self._exchange_active:
            finished = (
                self._reply_complete_at is not None
                and now - max(self._reply_complete_at, self._last_model_activity)
                >= self._REPLY_GRACE_SEC
            )
            if finished and not busy:
                return "wait_for_command" if self._exchange_is_nudge else "standby"
            if not busy and now >= self._awake_until + self._EXCHANGE_HARD_CAP_SEC:
                return "standby"
            return None

        # Nothing has been answered yet: still waiting for the command.
        if busy:
            return None
        if (
            self._nudge_state == "none"
            and not self._heard_command_speech
            and now - self._last_voiced_at >= self._NUDGE_AFTER_SEC
        ):
            return "nudge"
        if now >= self._awake_until:
            return "standby"
        return None

    def _enter_standby(self, reason: str = ""):
        """Close the mic: nothing more is streamed to Gemini until the next
        wake word. Shared by the reply-finished path and the no-command
        timeout so the two can't drift apart."""
        self._awake = False
        st = self._wake_stats
        print(
            "[Voice Agent] 📊 awake window: "
            f"sent {st['sent']} chunks; dropped {st['drop_speaking']} (Travis speaking), "
            f"{st['drop_tool']} (tool running), {st['drop_full']} (queue full)."
        )
        label = self._wake_model.label if self._wake_model else "travis"
        why = f" ({reason})" if reason else ""
        print(f"[Voice Agent] 🟠 Standby{why} — say '{label}' to wake.")
