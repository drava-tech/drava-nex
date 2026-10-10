"""TravisBase: shared state for the voice agent, assembled from focused mixins."""

from __future__ import annotations

import asyncio
import collections
import threading


# pyrefly: ignore [missing-import]

from audio.metrics import CaptureMeter
from ui import TravisUI


from agent.wake_word import WakeWordMixin
from agent.speaker_gate import SpeakerGateMixin
from agent.exchange_state import ExchangeStateMixin
from agent.playback import PlaybackMixin
from agent.mic_listener import MicListenerMixin
from agent.tool_runner import ToolRunnerMixin


class TravisBase(
    WakeWordMixin,
    SpeakerGateMixin,
    ExchangeStateMixin,
    PlaybackMixin,
    MicListenerMixin,
    ToolRunnerMixin,
):
    """The parts of TRAVIS that don't depend on how a command is understood: microphone capture,
the wake word, the chime, the exchange state machine (when the mic closes), speaker playback
and the tools. TravisLocal supplies speech-to-text, the command list/LLM and spoken replies."""

    def __init__(self, ui: TravisUI):
        self.ui = ui
        self.audio_in_queue = None
        self.elevenlabs = None
        self._loop = None
        # Per-awake-window audio accounting, printed at standby — shows where
        # mic audio went (sent, or dropped because Travis was speaking / a
        # tool was running / the send queue was full) and the longest network
        # send stall. Reset on each fresh wake word.
        self._wake_stats = {"sent": 0, "drop_speaking": 0, "drop_tool": 0, "drop_full": 0}
        # Where the current wake-word exchange stands — see _awake_action().
        # Reset on every fresh wake word.
        self._exchange_active = False  # a request is being answered
        self._followup_wanted = False  # the last reply asked a question: open the follow-up window when it has finished playing
        self._exchange_is_nudge = False  # ...and that answer is the "how can I help?" prompt
        self._reply_complete_at: float | None = None  # last turn_complete; None while a reply is unfinished
        self._last_model_activity = 0.0
        self._last_voiced_at = 0.0  # last time the mic was louder than the room
        self._voiced_cutoff = 0.01
        self._nudge_state = "none"  # none -> sent -> done, once per wake word
        # Wake-word double check: the speech-to-text transcript
        # since the wake word, whether it has confirmed "travis" was really
        # said, and whether the user has said anything beyond it (no nudge
        # then). Reset on every fresh wake word.
        self._wake_transcript = ""
        self._wake_confirmed = False
        self._heard_command_speech = False
        self._is_speaking = False
        # Count of tool bodies currently running (dispatch is fire-and-forget,
        # so more than one can overlap). Consumers read it truthily, so 0/>0
        # behaves like the old bool.
        self._tool_active = 0
        self._speaking_lock = threading.Lock()

        # Audio-device health (agent/mic_listener.py `_supervise_mic`, agent/playback.py).
        # Capture stats for the open mic stream; counters of recovery events; and the
        # handshake that lets the mic supervisor re-initialise PortAudio (after a
        # Bluetooth reconnect) while the speaker stream is closed.
        self._capture_meter = CaptureMeter()
        self._audio_events: dict[str, int] = {}
        self._audio_reset_wanted = False  # speaker asks the mic supervisor for a reset
        self._reinit_requested = False
        self._reinit_done = asyncio.Event()

        # Audio preroll queue and tool lifecycle tracking
        self._preroll_pcm = collections.deque(maxlen=16)

        # Current AI-driven visual card (for show_visual next/prev navigation).
        self._visual_card: dict | None = None
        self._visual_index = 0

        # Wake-word gate. While asleep, mic audio is processed locally by
        # openWakeWord only and never streamed to Gemini, so the agent ignores
        # anything not addressed to it. A sliding awake window keeps a
        # conversation open so follow-ups don't need to repeat the wake word.
        # Two interchangeable engines are supported (`wake_word_engine` in
        # config) — see OpenWakeWordDetector / VoskWakeWordDetector above:
        #   "openwakeword" (default) — a dedicated wake-word classifier.
        #     Free pretrained phrases only ("hey_jarvis" etc.), or a custom-
        #     trained model file if you have one.
        #   "vosk" — full offline speech recognition matching on text, so the
        #     phrase can be anything (e.g. "travis") with zero training.
        self._awake = False
        self._awake_until = 0.0
        self._awake_timeout = 15.0
        self._wake_model = (
            None  # a detector instance exposing .detect()/.label, or None
        )
        # Debounce: Vosk's grammar-restricted recognizer is polled on every
        # ~64ms audio chunk via PartialResult() — a single spoken "Travis"
        # can briefly show "travis" in several consecutive partial hypotheses
        # before the recognizer's internal state moves past that word, each
        # one independently satisfying detect()'s match check even after
        # Reset(). Observed in practice as 5-10+ back-to-back "Speaker
        # enrolled" log lines from one utterance. Suppress any detection
        # within this cooldown of the last one — a second genuine wake word
        # spoken that fast isn't a realistic use case to protect against.
        self._last_wake_detect_at: float | None = None
        self._WAKE_DEBOUNCE_SEC = 2.0
        # Latency instrumentation: timestamp of the most recent wake-word
        # trigger, consumed (and cleared) by the first tool call afterward so
        # "time since wake" is only ever reported once per wake, not on every
        # follow-up command within the same awake window.
        self._wake_engaged_at: float | None = None
        # Per-exchange named-stage latency breakdown (see _print_timing_report
        # and _TIMING_STAGES). Reset on every fresh wake word.
        self._timing: dict[str, float] = {}
        self._init_wake_word()

        # Target-speaker extraction: while awake, continuously stream mic
        # audio to Gemini with its volume scaled by how well a short rolling
        # window matches the voice that said the wake word — soft, ongoing
        # suppression of cross-talk (see _speaker_extraction_worker) rather
        # than the old hard per-block accept/reject gate. Every chunk is
        # always forwarded; only how loud it is depends on the match.
        self._extract_active = False
        self._extract_threshold = 0.65
        self._extract_window_sec = 0.45
        self._extract_hop_sec = 0.15
        self._extract_adapt_margin = 0.12
        self._extract_min_rms = 0.008
        self._extract_backend = "resemblyzer"  # or "gpu_separation_experimental"
        self._target_embed = None  # reference d-vector of the waker
        self._extract_q = None  # queue.Queue of ("wake"|"audio", pcm)
        # Gain state: _target is set by the background analysis thread from
        # its latest window; _applied is smoothed toward it on the audio
        # thread every callback so volume changes ramp instead of stepping
        # (avoids clicks). Both start at 1.0 (full volume) so audio before
        # the first window's worth has been analyzed passes through
        # untouched — the same effect the old gate's "enroll grace" had,
        # without needing a separate counter for it.
        self._extract_gain_target = 1.0
        self._extract_gain_applied = 1.0
        self._init_speaker_extraction()

    def speak(self, text: str):
        raise NotImplementedError

    def _enqueue_out(self, item):
        raise NotImplementedError
