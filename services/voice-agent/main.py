import asyncio
import collections
import os
import queue
import random
import socket
import threading
import time
import json
import sys
import traceback
import uuid
import warnings
from pathlib import Path

# ponytail: auto re-exec into adjacent .venv when invoked from external python.
# os.path.samefile() (identity, via the OS) rather than Path.resolve() equality
# (string comparison) — on Windows the same interpreter can resolve to two
# different-looking paths (short vs. long form, drive letter casing), which
# made this misfire and re-exec even when already invoked via this exact
# venv's python: every launch spawned an extra, untracked child process (a
# fresh PID each time, invisible to whatever launched the original one) that
# outlived it, which is how multiple copies ended up running simultaneously
# and fighting over the mic.
_venv_py = (
    Path(__file__).resolve().parent
    / ".venv"
    / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
)
try:
    _already_in_venv = _venv_py.is_file() and os.path.samefile(sys.executable, _venv_py)
except OSError:
    _already_in_venv = False
if _venv_py.is_file() and not _already_in_venv:
    import subprocess

    sys.exit(subprocess.call([str(_venv_py), *sys.argv]))

import numpy as np

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# BaseExceptionGroup fallback for Python < 3.11 compatibility / static analysis
try:
    BaseExceptionGroup
except NameError:
    try:
        # pyrefly: ignore [missing-import]
        from exceptiongroup import BaseExceptionGroup
    except ImportError:

        class BaseExceptionGroup(BaseException):  # type: ignore
            pass


warnings.filterwarnings(
    "ignore",
    message=r"there are non-data parts in the response.*",
)

# This service uses no pydantic plugins. Without this, pydantic (pulled in by
# google-genai) scans the metadata of every installed package at import time,
# which on Windows (cold cache + antivirus) can stall startup for a long time.
os.environ.setdefault("PYDANTIC_DISABLE_PLUGINS", "__all__")


# pyrefly: ignore [missing-import]
import sounddevice as sd

# pyrefly: ignore [missing-import]
from google import genai

# pyrefly: ignore [missing-import]
from google.genai import types
from ui import TravisUI
from memory.memory_manager import (
    load_memory,
    update_memory,
    should_extract_memory,
    extract_memory,
)

from core.language_gate import is_english
from core.transcript_gate import (
    has_speech_beyond_wake_word,
    is_noise,
    mentions_wake_word,
    strip_markers,
)
from actions import cms_client
from actions.device_control import device_control
from actions.screen_control import screen_control
from actions.list_inventory import list_inventory
from rag import knowledge_search


def _live_response_audio_data(response) -> bytes | None:
    """Extract audio bytes without touching SDK `.data`, which logs noisy warnings."""
    try:
        parts = response.server_content.model_turn.parts
    except Exception:
        return None

    chunks = []
    for part in parts or []:
        inline = getattr(part, "inline_data", None)
        data = getattr(inline, "data", None)
        if isinstance(data, bytes) and data:
            chunks.append(data)
    return b"".join(chunks) if chunks else None


def get_base_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent


BASE_DIR = get_base_dir()
API_CONFIG_PATH = BASE_DIR / "config" / "api_keys.json"
PROMPT_PATH = BASE_DIR / "core" / "prompt.txt"
LIVE_MODEL = "models/gemini-2.5-flash-native-audio-latest"
CHANNELS = 1
SEND_SAMPLE_RATE = 16000
RECEIVE_SAMPLE_RATE = 24000
CHUNK_SIZE = 1024


def _prefer_ipv4_for_gemini_live() -> None:
    """Avoid slow/broken IPv6 routes during Gemini Live WebSocket connect."""
    if os.getenv("TRAVIS_FORCE_IPV4", "1").strip().lower() in ("0", "false", "no"):
        return

    original_getaddrinfo = socket.getaddrinfo

    def getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        if str(host).lower() == "generativelanguage.googleapis.com":
            family = socket.AF_INET
        return original_getaddrinfo(host, port, family, type, proto, flags)

    socket.getaddrinfo = getaddrinfo
    print("[Voice Agent] Network: forcing IPv4 for Gemini Live.")


_api_config_cache: "tuple[float, dict] | None" = None


def _load_api_config() -> dict:
    """Config cached by file mtime — the JSON is rewritten at runtime (device
    settings, API-key UI), so a plain lru_cache would go stale. The returned
    dict is shared across callers: treat it as read-only.
    Environment variables or root .env take priority over config/api_keys.json.
    """
    global _api_config_cache
    mtime = os.path.getmtime(API_CONFIG_PATH) if API_CONFIG_PATH.exists() else 0.0
    cached = _api_config_cache
    if cached is not None and cached[0] == mtime:
        return cached[1]

    data = {}
    if API_CONFIG_PATH.exists():
        try:
            with open(API_CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            data = {}

    # Check root and local .env files if present
    for env_path in [BASE_DIR / ".env", BASE_DIR.parent.parent / ".env"]:
        if env_path.exists():
            try:
                for line in env_path.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k, v = k.strip(), v.strip().strip("'\"")
                        if k and v:
                            os.environ.setdefault(k, v)
            except Exception:
                pass

    # Map environment variables if set
    env_mapping = {
        "GEMINI_API_KEY": "gemini_api_key",
        "ELEVENLABS_API_KEY": "elevenlabs_api_key",
        "ELEVENLABS_VOICE_ID": "elevenlabs_voice_id",
        "ELEVENLABS_MODEL_ID": "elevenlabs_model_id",
        "TTS_ENGINE": "tts_engine",
        "CMS_VOICE_SECRET": "cms_voice_secret",
        "VOICE_AGENT_SECRET": "cms_voice_secret",
        "CMS_API_BASE_URL": "cms_api_base_url",
    }
    for env_key, conf_key in env_mapping.items():
        val = os.getenv(env_key)
        if val:
            data[conf_key] = val

    _api_config_cache = (mtime, data)
    return data


def _get_api_key() -> str:
    return _load_api_config()["gemini_api_key"]


def _resolve_input_device(name_hint: str):
    """Find an input device whose name contains name_hint (case-insensitive).

    Returns the sounddevice index, or None to use the OS default — including
    when the named device isn't present, so the agent still starts if the USB
    mic is unplugged.

    The same device name commonly appears multiple times, once per Windows
    audio host API (MME, DirectSound, WASAPI...), often at DIFFERENT native
    sample rates — found live (2026-09-24) with a Bluetooth headset: MME and
    DirectSound both reported it at 44100Hz, WASAPI at 16000Hz (its real
    native rate). Opening it via the wrong entry forces PortAudio to
    resample 44100->16000 on every callback, which measurably degraded
    local ASR transcription quality despite sounding fine to the ear —
    prefer whichever match's default_samplerate equals SEND_SAMPLE_RATE, so
    the stream needs no resampling at all.
    """
    hint = (name_hint or "").strip().lower()
    if not hint:
        return None
    matches = [
        (idx, dev)
        for idx, dev in enumerate(sd.query_devices())
        if dev["max_input_channels"] > 0 and hint in dev["name"].lower()
    ]
    if not matches:
        print(
            f"[Voice Agent] ⚠️ No input device matching '{name_hint}' — using default mic."
        )
        return None
    exact_rate = [
        (idx, dev)
        for idx, dev in matches
        if int(dev["default_samplerate"]) == SEND_SAMPLE_RATE
    ]
    idx, dev = (exact_rate or matches)[0]
    if not exact_rate:
        print(
            f"[Voice Agent] ⚠️ '{name_hint}' matched only at "
            f"{dev['default_samplerate']:.0f}Hz (need {SEND_SAMPLE_RATE}Hz) — "
            "PortAudio will resample; expect some quality loss."
        )
    print(f"[Voice Agent] 🎤 Input device: {dev['name']} (#{idx})")
    return idx


def _chunk_rms(pcm: bytes) -> float:
    """RMS level (0..1) of an int16 PCM chunk."""
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    return float(np.sqrt(np.mean(samples * samples))) if samples.size else 0.0


def _apply_gain(pcm: bytes, gain: float) -> bytes:
    """Scale int16 PCM by `gain`, clipping instead of wrapping around.

    Software volume for speakers that top out too quiet (a Bluetooth
    speakerphone in hands-free mode, for one)."""
    if gain == 1.0 or not pcm:
        return pcm
    samples = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) * gain
    return np.clip(samples, -32768, 32767).astype(np.int16).tobytes()


def _resolve_output_device(name_hint: str, avoid_hint: str = ""):
    """Find an output device for TTS playback.

    With a name_hint, picks an output device containing it (case-
    insensitive) — preferring, among same-named entries across host APIs
    (MME/DirectSound/WASAPI/WDM-KS), one whose default_samplerate exactly
    matches RECEIVE_SAMPLE_RATE, then a clean integer multiple of it (cheap,
    clean resampling), then falling back to the first match — same class of
    silent-resampling quality loss _resolve_input_device fixes for capture,
    found live with a Bluetooth headset. Without a name_hint, keeps the OS
    default — unless the default is the avoid_hint device (e.g. a USB
    speakerphone's own mic-adjacent speaker, which Windows tends to make
    default when plugged in), in which case the first other output device
    is used instead.
    """
    hint = (name_hint or "").strip().lower()
    avoid = (avoid_hint or "").strip().lower()
    devices = sd.query_devices()
    if hint:
        matches = [
            (idx, dev)
            for idx, dev in enumerate(devices)
            if dev["max_output_channels"] > 0 and hint in dev["name"].lower()
        ]
        if matches:
            exact = [
                (i, d)
                for i, d in matches
                if int(d["default_samplerate"]) == RECEIVE_SAMPLE_RATE
            ]
            # No "prefer a clean multiple" tier here, unlike the input
            # resolver: found live that WASAPI entries can outright REJECT
            # opening a stream at a non-native rate ([PaErrorCode -9997])
            # rather than resampling, where MME/DirectSound tolerate it —
            # so a mismatched-but-"cleaner-ratio" WASAPI entry can be
            # strictly worse than the plain first match. Only trust a
            # same-named entry over the default first-match behavior when
            # its rate is an exact match (verified to actually open).
            idx, dev = (exact or matches)[0]
            if not exact:
                print(
                    f"[Voice Agent] ⚠️ '{name_hint}' matched only at "
                    f"{dev['default_samplerate']:.0f}Hz (need "
                    f"{RECEIVE_SAMPLE_RATE}Hz) — PortAudio will resample."
                )
            print(f"[Voice Agent] 🔊 Output device: {dev['name']} (#{idx})")
            return idx
        print(
            f"[Voice Agent] ⚠️ No output device matching '{name_hint}' — using default."
        )
    if avoid:
        try:
            default_out = sd.query_devices(kind="output")
        except Exception:
            default_out = None
        if default_out is not None and avoid in default_out["name"].lower():
            for idx, dev in enumerate(devices):
                name = dev["name"].lower()
                # Skip virtual devices that just forward to the OS default.
                if "sound mapper" in name or "primary sound" in name:
                    continue
                if dev["max_output_channels"] > 0 and avoid not in name:
                    print(
                        f"[Voice Agent] 🔊 Default output is the {avoid_hint} — "
                        f"using {dev['name']} (#{idx}) instead."
                    )
                    return idx
    return None


def _load_system_prompt() -> str:
    try:
        return PROMPT_PATH.read_text(encoding="utf-8")
    except Exception:
        return (
            "You are TRAVIS, the voice control agent for a CMS platform. "
            "Be concise, direct, and always use the provided tools to complete tasks. "
            "Never simulate or guess results — always call the appropriate tool."
        )


_last_memory_input = ""


def _update_memory_async(user_text: str, travis_text: str) -> None:
    global _last_memory_input

    user_text = (user_text or "").strip()
    travis_text = (travis_text or "").strip()

    if len(user_text) < 5 or user_text == _last_memory_input:
        return
    _last_memory_input = user_text

    try:
        api_key = _get_api_key()
        if not should_extract_memory(user_text, travis_text, api_key):
            return
        data = extract_memory(user_text, travis_text, api_key)
        if data:
            update_memory(data)
            print(f"[Memory] ✅ {list(data.keys())}")
    except Exception as e:
        if "429" not in str(e):
            print(f"[Memory] ⚠️ {e}")


class _OpenWakeWordDetector:
    """Wraps openWakeWord: a tiny always-on neural classifier for one
    specific phrase. Fast and accurate, but only pretrained phrases are free
    without training a custom model (see _VoskWakeWordDetector for that)."""

    def __init__(self, configured: str, threshold: float):
        from openwakeword.model import Model
        from openwakeword.utils import download_models

        # Always fetch the shared melspectrogram/embedding/VAD models —
        # required by both pretrained and custom-trained wake models.
        download_models([])

        is_custom_file = configured.lower().endswith((".onnx", ".tflite")) or (
            "/" in configured or "\\" in configured
        )
        if is_custom_file:
            model_path = str((BASE_DIR / configured).resolve())
            if not Path(model_path).exists():
                raise FileNotFoundError(
                    f"custom wake-word model not found: {model_path}"
                )
            self._name = Path(model_path).stem
            self._model = Model(
                wakeword_models=[model_path], inference_framework="onnx"
            )
        else:
            download_models([configured])  # pretrained name — fetch if needed
            self._name = configured
            self._model = Model(
                wakeword_models=[configured], inference_framework="onnx"
            )
        self._threshold = threshold

    @property
    def label(self) -> str:
        return self._name.replace("_", " ")

    def detect(self, pcm_bytes: bytes) -> bool:
        pcm = np.frombuffer(pcm_bytes, dtype=np.int16)
        scores = self._model.predict(pcm)
        return scores.get(self._name, 0.0) >= self._threshold


# The earlier AI_Experience_Center prototype's Google-STT wake detector
# matched "travis" plus several ASR mishearings ("trevis", "traves", "trav",
# "trevas"). That doesn't transfer directly to Vosk's grammar-restricted
# decoding: those aren't real English words, and a grammar can only ever
# output words already in the acoustic model's dictionary — anything else is
# silently dropped (confirmed by Vosk's own "Ignoring word missing in
# vocabulary" warning). Google's cloud ASR is fuzzy enough to emit those
# non-word spellings; Vosk's fixed-dictionary decoder cannot, regardless of
# what's listed here.
#
# "travel" used to be listed as a fallback (the one mishearing variant that's
# an actual dictionary word) — removed after it caused real false wake-ups:
# it's common enough in ordinary conversation ("we need to travel...") that
# bystander speech kept falsely engaging the agent. A missed "Travis" just
# costs saying it again; a false wake-up costs an unwanted chime and the
# agent listening to a conversation that was never meant for it — the worse
# failure mode of the two.
_DEFAULT_WAKE_VARIANTS: dict[str, list[str]] = {}


class _VoskWakeWordDetector:
    """Wake-word detection via full offline speech recognition (Vosk)
    instead of a dedicated acoustic classifier. Lets the trigger phrase be
    anything (e.g. "travis") with zero training, at the cost of more CPU
    than a purpose-built wake-word model and occasional mishears on
    similar-sounding words. Grammar-restricted to the phrase and its known
    variants (+ a catch-all "[unk]" token) rather than open-vocabulary
    decoding, which keeps it fast and cuts down on unrelated false matches.

    Matches on PartialResult() streaming hypotheses, specifically the first
    one or two words of the current partial — not FINAL results
    (AcceptWaveform returning True). Finals only arrive at an utterance
    boundary (a real pause), which made "Travis, turn off the lights"
    spoken as one continuous sentence never finalize "Travis" on its own in
    time: the whole sentence had to finish before there was anything to
    check, by which point the command audio itself had already gone
    unstreamed. The leading word of a partial appears within a couple of
    audio chunks of the word actually being spoken, regardless of what
    follows it in the same breath.

    Partials carry no per-word confidence (unlike finals with
    SetWords(True)), so the anti-false-positive job that confidence used to
    do is replaced with a stability requirement instead: the leading word
    must match for `partial_confirm_frames` consecutive chunks (~64ms each)
    before it counts, filtering a one-off misread without waiting for a
    pause. Two things make that requirement itself more forgiving, since a
    partial hypothesis is revisable and can briefly guess wrong before
    settling: the check looks at the first TWO and the last TWO recognized
    words (a stray click/breath can get misheard as a short bogus token
    ahead of "travis" itself, and a hypothesis that keeps growing pushes a
    newly spoken "travis" toward the end), and a single missed frame doesn't reset
    the streak — only two misses in a row do. Firing resets the recognizer
    so the rest of the utterance (the actual command) starts Vosk fresh for
    the *next* wake word rather than re-matching leftovers of this one — it
    does not affect the real command audio, which is streamed to Gemini
    independently of Vosk.
    """

    def __init__(
        self,
        phrase: str,
        sample_rate: int,
        variants: list[str] | None = None,
        partial_confirm_frames: int = 2,
    ):
        import vosk

        vosk.SetLogLevel(
            -1
        )  # Vosk logs to stderr by default; too noisy for our console.
        self._phrase = phrase.strip().lower()
        if variants is None:
            variants = _DEFAULT_WAKE_VARIANTS.get(self._phrase, [])
        self._match_words = {self._phrase, *(v.strip().lower() for v in variants)}
        self._partial_confirm_frames = max(1, partial_confirm_frames)
        self._partial_streak = 0
        self._miss_streak = 0
        self.last_partial = ""  # latest hypothesis, for wake-miss diagnostics
        model = vosk.Model(lang="en-us")  # auto-downloaded/cached on first use (~40MB)
        grammar = [*sorted(self._match_words), "[unk]"]
        self._rec = vosk.KaldiRecognizer(model, sample_rate, json.dumps(grammar))

    @property
    def label(self) -> str:
        return self._phrase

    def detect(self, pcm_bytes: bytes) -> bool:
        self._rec.AcceptWaveform(pcm_bytes)  # advances decoder state either way
        partial = json.loads(self._rec.PartialResult()).get("partial", "").strip()
        self.last_partial = partial
        words = partial.lower().split()
        # Check the first TWO and the LAST two recognized words. The first
        # two, not just position 1: a brief click/breath at the start can get
        # misheard as a short stray token ("[unk]") before Vosk's hypothesis
        # resolves onto "travis". The last two because the hypothesis keeps
        # growing while there's continuous sound — Vosk only finalizes on a
        # pause — so a "travis" spoken after other sounds (room noise, "so
        # um…", Travis's own reply being decoded) lands at position 3+ and
        # was never seen: observed live as the decoder hearing
        # '[unk] [unk] travis [unk] travis …' with no wake at all. Newly
        # spoken words always arrive at the tail.
        matched = any(w in self._match_words for w in words[:2] + words[-2:])

        if matched:
            self._partial_streak += 1
            self._miss_streak = 0
        else:
            # Don't wipe the streak on a single flickered miss — a partial
            # hypothesis is revisable, and Vosk can briefly guess wrong in
            # the first instant of a word before settling on the right one
            # as more audio arrives. Only treat it as a genuine miss (and
            # restart counting) after two misses in a row.
            self._miss_streak += 1
            if self._miss_streak >= 2:
                self._partial_streak = 0
                self._miss_streak = 0

        if self._partial_streak >= self._partial_confirm_frames:
            self._partial_streak = 0
            self._miss_streak = 0
            self._rec.Reset()  # start fresh for the next wake word
            return True
        return False


TOOL_DECLARATIONS = [
    {
        "name": "show_visual",
        "description": (
            "Display an on-screen visual on the agent's screen to help the person "
            "UNDERSTAND something, instead of explaining with words alone. "
            "USE THIS whenever a picture or a step-by-step diagram would explain "
            "better than speech: a how-to, a process, a comparison, or showing a "
            "reference image. "
            "Flow: call action 'show' once with a 'title' and the full list of "
            "'steps' (each a short heading + detail). Then, as you narrate, call "
            "'next' / 'prev' to move the on-screen highlight in sync with what you "
            "are saying, and 'clear' when you are finished so the screen returns to "
            "normal. For a single picture, pass 'image_url' (or 'image_path') and an "
            "optional 'caption' instead of steps. Keep headings and details short; "
            "speak naturally alongside the visual."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {
                    "type": "STRING",
                    "description": "show | next | prev | clear",
                },
                "title": {
                    "type": "STRING",
                    "description": "Short title shown at the top of the visual.",
                },
                "steps": {
                    "type": "ARRAY",
                    "description": (
                        "Ordered steps for a how-to walkthrough. Provide the whole "
                        "list with action 'show'."
                    ),
                    "items": {
                        "type": "OBJECT",
                        "properties": {
                            "heading": {
                                "type": "STRING",
                                "description": "Short step title.",
                            },
                            "detail": {
                                "type": "STRING",
                                "description": "One or two sentences of detail.",
                            },
                            "highlight": {
                                "type": "STRING",
                                "description": "Optional key point to emphasise.",
                            },
                        },
                        "required": ["heading"],
                    },
                },
                "image_url": {
                    "type": "STRING",
                    "description": "Optional image URL to display instead of steps.",
                },
                "image_path": {
                    "type": "STRING",
                    "description": "Optional local image file path to display.",
                },
                "caption": {
                    "type": "STRING",
                    "description": "Optional caption shown under an image.",
                },
            },
            "required": ["action"],
        },
    },
    {
        "name": "shutdown_travis",
        "description": (
            "Shuts down the assistant completely. "
            "Call this when the user expresses clear intent to end the "
            "conversation or stop the agent itself — closing the assistant, "
            "not the room. Do NOT call this for 'bye' — that phrase "
            "is device_control's catch-all for turning off the room's "
            "lights and AC (action:'good_night'), even though it sounds "
            "like a sign-off. Only treat a goodbye-style phrase as shutdown "
            "when it's unmistakably about ending the session with YOU "
            "specifically (e.g. 'shut yourself down', 'stop listening', "
            "'that's all from you today'), not just about the room. "
            "The user can say this in ANY language."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {},
        },
    },
    {
        "name": "save_memory",
        "description": (
            "Save an important personal fact about the user to long-term memory. "
            "Call this silently whenever the user reveals something worth remembering: "
            "name, role, preferences, or recurring requests. "
            "Do NOT call for: weather, reminders, searches, or one-time commands. "
            "Do NOT announce that you are saving — just call it silently. "
            "Values must be in English regardless of the conversation language."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "category": {
                    "type": "STRING",
                    "description": (
                        "identity — name, role, language | "
                        "preferences — favorite scenes/screens, preferred lighting, routines | "
                        "notes — anything else worth remembering"
                    ),
                },
                "key": {
                    "type": "STRING",
                    "description": "Short snake_case key (e.g. name, preferred_scene)",
                },
                "value": {"type": "STRING", "description": "Concise value in English"},
            },
            "required": ["category", "key", "value"],
        },
    },
    {
        "name": "knowledge_search",
        "description": (
            "Search the local knowledge base for grounded information about this "
            "CMS deployment: operating hours, or venue FAQs the operator has "
            "documented in writing. Do NOT use this for 'what screens/devices "
            "exist' or 'how many do you have' — that's list_inventory's job, "
            "since this knowledge base is static documentation and can be stale "
            "or generic, while list_inventory always reflects the CMS's real, "
            "current list. ALSO use knowledge_search to recall previously saved "
            "facts about the current user (their name, preferences, ongoing "
            "projects, etc. — anything remembered via save_memory) — nothing is "
            "given to you upfront, so if a request depends on something you might "
            "already know about this person, search for it here first rather than "
            "asking them to repeat it or assuming you don't know. Prefer this over "
            "Google Search for venue/CMS/personal questions; use Google Search only "
            "for general or time-sensitive web facts. If it returns no relevant "
            "info, say you don't have that detail rather than guessing."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {
                    "type": "STRING",
                    "description": "The information need, phrased as a clear search query.",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "list_inventory",
        "description": (
            "Answers 'what screens/devices exist', 'how many screens do you "
            "have', 'list the screens', 'what devices can you control' — "
            "returns the CMS's REAL, current inventory (live from the "
            "database), not documentation. Use this instead of knowledge_search "
            "for any question about what actually exists right now. Also useful "
            "before telling a user 'which one did you mean' when a target name "
            "didn't resolve, if you need to see the real options yourself first."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "kind": {
                    "type": "STRING",
                    "description": "'screens' | 'devices' | 'both' — which inventory to list. Defaults to 'both' if omitted.",
                },
            },
        },
    },
    {
        "name": "device_control",
        "description": (
            "Controls a physical room device through the CMS: lights, the AC, "
            "any other IR-controlled device such as the TV, or the front door "
            "lock. For the TV, use this ONLY for its remote-control buttons "
            "(power, volume, mute, channel, input): words like stop, pause, "
            "play, skip, show, push, display, idle or reset are about what a "
            "SCREEN is showing, so they belong to screen_control even when "
            "the screen's name contains 'TV' — and 'stop' NEVER means power "
            "off. Only send power when the user says turn on/off/power. "
            "VOLUME: the room's sound comes from the soundbar, which is "
            "controlled through the TV's remote. For ANY louder / quieter / "
            "volume / mute request — however it's aimed ('the soundbar', "
            "'the TV', or just 'volume') — call action:'ac_command' with "
            "command 'Volume Up', 'Volume Down' or 'mute' and params.times "
            "(1 = a nudge, 3 = a normal 'turn it up', 6 = 'a lot'). There is "
            "NO way to set or read an exact volume level, so never state a "
            "volume number or percentage; report only what the tool says. "
            "USE THIS for anything about the room's hardware: 'turn on "
            "the lights', 'turn on tusker L1', 'turn on tusker L2', 'turn on "
            "tusker L3' (controls both fabric lights together), 'dim tusker "
            "edge to 30%', 'turn on tusker ac', 'set tusker ac to 22 degrees', "
            "'turn up the TV volume', 'turn up volume on tusker 86', 'mute tusker 86', 'turn down the soundbar', 'lock the door', "
            "'unlock the door', 'are the lights on'. "
            "For 'bye', 'shut everything down', 'we're done for the "
            "day', or similar catch-all requests to turn the room off "
            "INCLUDING the AC, use action:'good_night' — it turns off every "
            "light and the AC in one call. Its opposite: for 'hi', "
            "'turn everything on', 'let's start the day', use "
            "action:'good_morning' — it turns on every light AND the AC in "
            "one call (the lights come up in pre-entry mode). For "
            "'pre-entry mode', 'entry mode', 'meeting mode' or "
            "'presentation mode', use action:'ambient_mode' with target = "
            "the mode name as said ('pre-entry', 'entry', 'meeting', "
            "'presentation') — lights only, the AC is untouched, and the "
            "colour and brightness are saved settings you never state. "
            "'entry' and 'pre-entry' are different modes. That is triggered by the words alone, never by the "
            "time: say it at 9pm or 3am and it is still a command, so don't "
            "refuse, question or comment on the hour. For 'turn on all the "
            "lights'/'turn on all lights'/'light up the room' (lights only, "
            "no AC implied), use action:'all_lights_on'. For 'turn off all "
            "the lights'/'turn off all lights' (lights only — NOT "
            "good_night, since that phrase says nothing about the AC and "
            "shouldn't switch it off as a side effect), use "
            "action:'all_lights_off'. "
            "Don't enumerate individual lights yourself for any of these "
            "these; the CMS already knows the full device list. "
            "Light fixtures are registered with arbitrary custom names that "
            "don't necessarily contain the word 'light' — a request to turn "
            "on/off/dim/recolor ANY named thing that isn't a known screen "
            "(see screen_control) is a device_control call, never "
            "screen_control, even if the name alone doesn't obviously sound "
            "like a light. "
            "'target' is the device name EXACTLY as the user said it — never "
            "add, drop or change a word or number they didn't say. A name "
            "without a number covers the whole numbered family together (the "
            "CMS applies it to all of them), so don't pick one member "
            "yourself. Not needed for "
            "lock/unlock/good_night/good_morning/all_lights_on/all_lights_off; for "
            "ambient_mode it is the mode name. If the CMS "
            "can't tell which device you mean, or doesn't recognize a "
            "command for that specific device, it will say so; ask the user "
            "to be more specific or try different wording rather than "
            "guessing or repeating the exact same call."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {
                    "type": "STRING",
                    "description": "lights_on | lights_off | lights_set | ac_command | lock | unlock | status | good_night | good_morning | ambient_mode | all_lights_on | all_lights_off",
                },
                "target": {
                    "type": "STRING",
                    "description": "The device name exactly as the user said it — never add or change a word or number. For ambient_mode, the mode name as said (pre-entry, entry, meeting, presentation). Not needed for lock/unlock/good_night/good_morning/all_lights_on/all_lights_off.",
                },
                "brightness": {
                    "type": "INTEGER",
                    "description": "0-100, for lights_set.",
                },
                "color": {
                    "type": "STRING",
                    "description": "The colour as said (e.g. blue, warm white, purple) or a hex like #100073, for lights_set. Supported names: warm white, neutral white, red, green, blue, cyan, magenta, yellow, orange, purple.",
                },
                "command": {
                    "type": "STRING",
                    "description": (
                        "The IR codebook verb for ac_command. For the AC specifically, use exactly: "
                        "power_on | power_off | set_temp | set_mode | set_fan. "
                        "For the TV, use one of its real registered buttons (names are case-sensitive): "
                        "Power | Volume Up | Volume Down | mute | Channel Up | Channel Down | OK | Menu | "
                        "Up | Down | Left | Right | source | input | exit | 0-9 (digits). "
                        "Each call is ONE press — for 'turn it up a lot', call it a few times rather than once. "
                        "For any other IR remote, use a short verb matching what the user asked for — the "
                        "CMS knows that device's actual registered button names and will report back if "
                        "yours doesn't match one, so you can ask the user to rephrase instead of retrying "
                        "blindly."
                    ),
                },
                "params": {
                    "type": "OBJECT",
                    "description": "Extra args for ac_command — only the field matching `command`.",
                    "properties": {
                        "temp": {
                            "type": "INTEGER",
                            "description": "Target temperature in Celsius, for command=set_temp.",
                        },
                        "mode": {
                            "type": "STRING",
                            "description": "cool | heat | auto | fan | dry, for command=set_mode.",
                        },
                        "fan": {
                            "type": "STRING",
                            "description": "auto | low | mid | high, for command=set_fan.",
                        },
                        "times": {
                            "type": "INTEGER",
                            "description": (
                                "For Volume Up / Volume Down: how many steps to press. "
                                "1 = a nudge, 3 = a normal 'turn it up/down', "
                                "6 = 'a lot'. Max 10."
                            ),
                        },
                    },
                },
            },
            "required": ["action"],
        },
    },
    {
        "name": "screen_control",
        "description": (
            "Controls what a CMS screen is showing, and its playback, USE "
            "THIS ONLY for an actual display screen — a monitor/TV/kiosk "
            "that shows CMS content: 'push <experience> to tusker 86', 'show "
            "<video> on tusker 27', 'set tusker 86 to idle', 'stop tusker 86', "
            "'pause the video on tusker 27', 'skip forward on tusker 86', "
            "'next item on tusker 27', 'reset the view', 'what's on "
            "<screen>' — where <screen> "
            "and <experience> are whatever names the USER actually said (e.g. "
            "'tusker 86', 'tusker 27'). "
            "NEVER make up a screen or content name: if the user didn't "
            "name a screen, leave 'screen' out entirely (the tool will ask "
            "them, or reuse the one just discussed). 'stop' means the CMS "
            "screen's own Stop button (action:'stop', blanks it to solid "
            "black) — NOT pause; 'reset the view' is the CMS's Reset view "
            "button (action:'reset_view'). play/pause/"
            "seek_forward/seek_back/reset_view only make sense for playable "
            "content (video, or a scrubbable/paged experience) — if the "
            "screen isn't showing anything like that, say so rather than "
            "calling it. next_item/previous_item only work when that screen "
            "has an active playlist queued; the tool will say if it doesn't. "
            "Do NOT use this for a light fixture, the AC, or any other "
            "physical device just because its name is unfamiliar or doesn't "
            "obviously indicate what it is — that's device_control's job, "
            "regardless of the device's name. 'screen' and 'content' are "
            "spoken names exactly as the user said them — the CMS resolves "
            "them to the actual records. If it can't tell which one you "
            "mean, it replies with the real options: offer ONLY those, "
            "never invent one."
        ),
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action": {
                    "type": "STRING",
                    "description": (
                        "assign_experience | assign_media | idle | stop | status | "
                        "play | pause | seek_forward | seek_back | "
                        "next_item | previous_item | reset_view"
                    ),
                },
                "screen": {
                    "type": "STRING",
                    "description": (
                        "The screen name exactly as the user said it. OMIT this "
                        "if the user didn't name one — never guess or make one up."
                    ),
                },
                "content": {
                    "type": "STRING",
                    "description": "Spoken experience or media name — required for assign_experience/assign_media.",
                },
            },
            "required": ["action"],
        },
    },
]


class _IdleDisconnect(Exception):
    """Raised internally by _idle_watchdog to unwind the current Gemini Live
    session once the awake window lapses with nothing in flight. Not an
    error — caught in run() and handled as a clean, deliberate disconnect."""


class TravisLive:
    def __init__(self, ui: TravisUI):
        self.ui = ui
        self.session = None
        self.audio_in_queue = None
        self.out_queue = None
        self.elevenlabs = None
        self._loop = None
        # Audio captured after the wake word but before out_queue exists yet
        # (Gemini isn't connected until the wake word fires — see run()) used
        # to be silently dropped, which meant however long the connect
        # handshake took came straight out of the user's command: by the time
        # the session was ready, the start of what they said (sometimes all
        # of it) was already gone. Buffered here instead and flushed into
        # out_queue the moment it's created. Capped at _PENDING_AUDIO_MAX_CHUNKS
        # (~4s) as a sane ceiling, not because that's expected to be hit.
        self._pending_audio: list[dict] = []
        # Per-awake-window audio accounting, printed at standby — shows where
        # mic audio went (sent, or dropped because Travis was speaking / a
        # tool was running / the send queue was full) and the longest network
        # send stall. Reset on each fresh wake word.
        self._wake_stats = {"sent": 0, "drop_speaking": 0, "drop_tool": 0, "drop_full": 0}
        self._max_send_ms = 0.0
        # Where the current wake-word exchange stands — see _awake_action().
        # Reset on every fresh wake word.
        self._exchange_active = False  # Gemini has started answering a request
        self._exchange_is_nudge = False  # ...and that answer is the "how can I help?" prompt
        self._reply_complete_at: float | None = None  # last turn_complete; None while a reply is unfinished
        self._last_model_activity = 0.0
        self._last_voiced_at = 0.0  # last time the mic was louder than the room
        self._voiced_cutoff = 0.01
        self._nudge_state = "none"  # none -> sent -> done, once per wake word
        # After the "how can I help?" prompt has been answered once, any
        # further model turn (a stray second answer to the same wake word)
        # is muted until the user actually speaks again.
        self._mute_extra_replies = False
        # Wake-word double check (see _turn_mute_reason): Gemini's transcript
        # since the wake word, whether it has confirmed "travis" was really
        # said, and whether the user has said anything beyond it (no nudge
        # then). Reset on every fresh wake word.
        self._wake_transcript = ""
        self._wake_confirmed = False
        self._heard_command_speech = False
        # Why the current model turn must not be spoken/acted on (None =
        # fine). Decided from the user's transcript, cleared on turn_complete.
        self._turn_mute_reason: str | None = None
        self._is_speaking = False
        # Count of tool bodies currently running (dispatch is fire-and-forget,
        # so more than one can overlap). Consumers read it truthily, so 0/>0
        # behaves like the old bool.
        self._tool_active = 0
        # Strong refs to in-flight tool tasks (create_task results are GC-able
        # otherwise).
        self._tool_tasks: set = set()
        self._tool_lock = asyncio.Lock()
        self._speaking_lock = threading.Lock()
        self.ui.on_text_command = self._on_text_command

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
        # config) — see _OpenWakeWordDetector / _VoskWakeWordDetector above:
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
        # Latency instrumentation: timestamp of the most recently sent
        # send_tool_response, consumed (and cleared) by the first audio chunk
        # _play_audio writes afterward. Everything between "took Xms" (the
        # tool call itself) and hearing TRAVIS speak — Gemini generating the
        # reply and synthesizing speech, plus our own playback pipeline — was
        # previously invisible; this fills that gap.
        self._tool_response_sent_at: float | None = None
        # Latency instrumentation: timestamp of the most recent input-
        # transcription chunk (Gemini's live transcript of what the user is
        # saying) — the closest proxy available to "the user just stopped
        # talking". Consumed by the next tool_call to measure the gap our
        # other timers miss: end of speech -> Gemini's own turn-completion
        # detection + inference to decide a tool call is needed, which is
        # NOT covered by "since wake word" (includes speech duration) or
        # "tool response to spoken reply" (starts only after the tool runs).
        self._last_input_transcription_at: float | None = None
        # Set (threadsafe) when the wake word fires while disconnected, so the
        # reconnect loop can skip its backoff sleep and come back immediately.
        self._reconnect_now = None  # asyncio.Event, created in run()
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

    def _init_wake_word(self):
        """Create the configured wake-word detector. Neither engine needs an
        account or API key (unlike Porcupine, whose free tier still requires
        a Picovoice AccessKey). On any failure (package missing, model not
        found/downloadable), log a warning and fall back to always-listening
        behavior rather than refusing to start."""
        try:
            cfg = _load_api_config()
            self._awake_timeout = float(cfg.get("awake_timeout_sec", 15.0))
            engine = (cfg.get("wake_word_engine") or "openwakeword").strip().lower()

            if engine == "vosk":
                phrase = cfg.get("wake_word_phrase") or "travis"
                variants = cfg.get(
                    "wake_word_variants"
                )  # None => built-in defaults for the phrase
                partial_confirm_frames = int(cfg.get("wake_word_partial_confirm_frames", 1))
                self._wake_model = _VoskWakeWordDetector(
                    phrase, SEND_SAMPLE_RATE, variants, partial_confirm_frames
                )
            else:
                configured = cfg.get("wake_word_model") or "hey_jarvis"
                threshold = float(cfg.get("wake_word_threshold", 0.5))
                self._wake_model = _OpenWakeWordDetector(configured, threshold)

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

    def _release_wake_word(self):
        # openWakeWord's Model holds plain onnxruntime sessions with no
        # explicit teardown API (unlike Porcupine's native handle) — dropping
        # the reference is enough.
        self._wake_model = None

    _PENDING_AUDIO_MAX_CHUNKS = 64  # ~4s at CHUNK_SIZE/SEND_SAMPLE_RATE

    def _enqueue_out(self, item):
        """Push a media frame onto the Gemini send queue, or buffer it if
        there's no live connection yet (dropped on overflow either way)."""
        if self.out_queue is None:
            if len(self._pending_audio) < self._PENDING_AUDIO_MAX_CHUNKS:
                self._pending_audio.append(item)
                if len(self._pending_audio) == 1:
                    print("[Voice Agent] 🧊 Buffering audio (no connection yet)...")
            else:
                print("[Voice Agent] 🧊 Pending-audio buffer full — dropping chunk.")
            return
        try:
            self.out_queue.put_nowait(item)
        except asyncio.QueueFull:
            self._wake_stats["drop_full"] += 1

    # ── Target-speaker extraction ────────────────────────────────────────
    def _init_speaker_extraction(self):
        """Enable continuous target-speaker extraction if opted in and the
        model loads. Unlike the old speaker gate, this never hard-drops
        audio — it only scales it, so it can't block or delay command
        capture waiting on a verification decision."""
        try:
            cfg = _load_api_config()
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
            # Was a hardcoded 0.015 in core/speaker.py — too high for a mic
            # quieter than whatever it was originally tuned against, which
            # silently made every embed() call return None (see speaker.py's
            # embed() docstring). Configurable now so it can be tuned without
            # a code change; default lowered from the old hardcoded value.
            self._extract_min_rms = float(cfg.get("speaker_min_rms", 0.008))

            from core import speaker

            if not speaker.available():
                print(
                    "[Voice Agent] ⚠️ Target-speaker extraction enabled but model "
                    "unavailable (pip install resemblyzer). Streaming all awake audio."
                )
                return

            # Experimental (2026-09-22 research spike): a GPU source-
            # separation backend as an alternative to the CPU Resemblyzer
            # gain gate above — see core/target_speaker_gpu.py for why and
            # its caveats. OFF unless explicitly opted into in config;
            # any load/inference failure falls straight back to the
            # Resemblyzer path below, never blocks startup.
            self._extract_backend = str(
                cfg.get("speaker_extraction_backend", "resemblyzer")
            ).strip().lower()
            if self._extract_backend == "gpu_separation_experimental":
                try:
                    from core import target_speaker_gpu

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
        from core import speaker

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
        from core import speaker

        rolling = bytearray()
        window_bytes = int(self._extract_window_sec * SEND_SAMPLE_RATE) * 2  # int16
        hop_bytes = int(self._extract_hop_sec * SEND_SAMPLE_RATE) * 2
        since_hop = 0
        # Resemblyzer's own floor (core/speaker.py's _MIN_SECONDS) — below
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
                from core import target_speaker_gpu

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

    def _on_text_command(self, text: str):
        if not self._loop or not self.session:
            return
        asyncio.run_coroutine_threadsafe(
            self.session.send_client_content(
                turns={"parts": [{"text": text}]}, turn_complete=True
            ),
            self._loop,
        )

    # After "Travis", how long the room may stay silent before Travis asks
    # what the user wants.
    _NUDGE_AFTER_SEC = 2.0
    _NUDGE_TEXT = (
        "[NUDGE] The user just said your name but hasn't asked for anything "
        "yet. In one short sentence, ask what they'd like."
    )
    # After Gemini says a turn is complete, how long everything must stay quiet
    # (no new audio, no tool call, nothing playing) before the mic closes.
    _REPLY_GRACE_SEC = 1.0
    # A request still being worked on may run this long past awake_timeout_sec
    # before the mic is closed on it anyway (a lost turn_complete must not
    # leave the mic open forever).
    _EXCHANGE_HARD_CAP_SEC = 30.0

    def _on_model_activity(self):
        """Gemini produced audio or a tool call: a request is being answered."""
        self._last_model_activity = time.monotonic()
        if self._awake:
            self._exchange_active = True
        # First sign of a response this exchange (once per wake word).
        self._timing.setdefault("gemini_response_started", self._last_model_activity)

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
        ("gemini_response_started", "gemini_response_started"),
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

    def _mute_reason_for(self, user_text: str) -> str | None:
        """Why the model turn answering `user_text` must be neither spoken
        nor acted on, or None if it may go ahead. TRAVIS only answers English
        commands that came after a real "Travis":
        - "not awake": the reply is to audio from before standby, or there
          was no wake word at all;
        - "noise": Gemini heard only markers like "<noise>";
        - "not English";
        - "false wake": Gemini's transcript since the wake word has real
          words but nothing like "travis" (Vosk misheard something else).
        The reply to our own nudge, and the user's answer to it (which needs
        no second "Travis"), skip the wake check. An empty transcript fails
        open — Gemini's transcription can lag or drop a lone short word."""
        if self._wake_model is None:
            return None  # always-listening fallback: no wake word to check
        if not self._awake:
            return "not awake"
        if is_noise(user_text):
            return None if self._nudge_state == "sent" else "noise"
        text = strip_markers(user_text).strip()
        if not is_english(text):
            return "not English"
        if self._nudge_state == "none" and text and not self._wake_confirmed:
            return "false wake"
        return None

    def _mute_turn(self, reason: str):
        """Silence the rest of the current model turn (see _mute_reason_for);
        a false wake also closes the mic straight away."""
        if self._turn_mute_reason is not None:
            return
        self._turn_mute_reason = reason
        print(f"[Voice Agent] 🔇 Ignoring this turn ({reason}).")
        if reason == "false wake" and self._awake:
            self._enter_standby("false wake — no 'travis' in what was heard")
            if not self.ui.muted:
                self.ui.set_state("THINKING")

    def _enter_standby(self, reason: str = ""):
        """Close the mic: nothing more is streamed to Gemini until the next
        wake word. Shared by the reply-finished path and the no-command
        timeout so the two can't drift apart."""
        self._awake = False
        st = self._wake_stats
        print(
            "[Voice Agent] 📊 awake window: "
            f"sent {st['sent']} chunks; dropped {st['drop_speaking']} (Travis speaking), "
            f"{st['drop_tool']} (tool running), {st['drop_full']} (send queue full); "
            f"slowest network send {self._max_send_ms:.0f}ms."
        )
        label = self._wake_model.label if self._wake_model else "travis"
        why = f" ({reason})" if reason else ""
        print(f"[Voice Agent] 🟠 Standby{why} — say '{label}' to wake.")

    def set_speaking(self, value: bool):
        with self._speaking_lock:
            self._is_speaking = value
        if value:
            self.ui.set_state("SPEAKING")
        elif not self.ui.muted:
            self.ui.set_state("LISTENING")

    def _drain_audio_queue(self):
        if self.elevenlabs is not None:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(self.elevenlabs.cancel())
            except RuntimeError:
                if self._loop and self._loop.is_running():
                    asyncio.run_coroutine_threadsafe(self.elevenlabs.cancel(), self._loop)
        if not self.audio_in_queue:
            return
        while True:
            try:
                self.audio_in_queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    def _clear_preroll(self):
        self._preroll_pcm.clear()


    def speak(self, text: str):
        if not self._loop or not self.session:
            return
        asyncio.run_coroutine_threadsafe(
            self.session.send_client_content(
                turns={"parts": [{"text": text}]}, turn_complete=True
            ),
            self._loop,
        )

    def tool_log(self, text: str):
        text = (text or "").strip()
        if text:
            self.ui.write_log(f"TRAVIS: {text}")

    def speak_error(self, tool_name: str, error: str):
        short = str(error)[:120]
        self.ui.write_log(f"ERR: {tool_name} — {short}")
        self.speak(f"{tool_name} encountered an error. {short}")

    def _build_config(self) -> types.LiveConnectConfig:
        from datetime import datetime

        memory = load_memory()
        sys_prompt = _load_system_prompt()

        now = datetime.now()
        time_str = now.strftime("%A, %B %d, %Y — %I:%M %p")
        time_ctx = f"[CURRENT DATE & TIME]\nRight now it is: {time_str}\n\n"

        primary_lang = (memory.get("identity", {}).get("language", {}) or {}).get(
            "value"
        ) or "English"
        lang_ctx = f"[PRIMARY LANGUAGE]\nYour primary language is {primary_lang}.\n\n"

        # Deliberately NOT injecting the full memory dump here. Every saved
        # fact used to be re-sent on every single turn regardless of whether
        # it mattered to that turn — real, unbounded latency that only grows
        # as more gets remembered. Memory is already indexed into the RAG
        # corpus (rag/sources.py's load_memory_knowledge), so knowledge_search
        # retrieves the specific relevant fact on demand instead — see its
        # tool description and core/prompt.txt for how that's surfaced.
        parts = [lang_ctx, time_ctx, sys_prompt]

        cfg = _load_api_config()
        return types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            # Reasoning is on by default for this model (its thought
            # summaries — "**Analyzing the Input**" — were showing up as
            # TRAVIS's speech in the log) and cost 1.3–3s between the end of
            # a spoken command and the tool call, for "unlock the door"-sized
            # requests that need no deliberation. Budget 0 turns it off.
            thinking_config=types.ThinkingConfig(thinking_budget=0),
            system_instruction="\n".join(parts),
            # English-only command gating: hint (not translate) the ASR to
            # English instead of leaving it on automatic language detection,
            # so it transcribes what was said rather than guessing at and
            # normalizing some other language. LanguageHints, not
            # LanguageAuto — this is the ASR-side half of the gate; the
            # system prompt's LANGUAGE section and the code-level check in
            # _run_tool_call (core/language_gate.is_english) are the other
            # two (2026-09-22).
            input_audio_transcription=types.AudioTranscriptionConfig(
                language_hints=types.LanguageHints(
                    language_codes=cfg.get(
                        "asr_language_codes", ["en-IN", "en-US"]
                    )
                )
            ),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            tools=[
                {"google_search": {}},
                {"function_declarations": TOOL_DECLARATIONS},
            ],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Sulafat")
                )
            ),
            # Gemini's own voice-activity detection decides both when the
            # user has started talking (start_of_speech_sensitivity) and when
            # they're done (end_of_speech_sensitivity → the wait before it
            # starts responding, real user-facing latency).
            #
            # start: HIGH (Gemini Live's own default). It was LOW to stop
            # room noise/cross-talk from repeatedly registering as a new
            # speech start while the speaker gate was passing raw audio
            # through; audio is now only streamed after the wake word, and
            # never while Travis is speaking, so that risk is gone — and LOW
            # makes Gemini commit to "speech started" later, which is
            # exactly what can clip the opening words of a same-breath
            # "Travis, <command>" arriving as a pre-roll burst.
            # end: HIGH + a short silence window — this is the wait after
            # you stop talking before it answers.
            realtime_input_config=types.RealtimeInputConfig(
                automatic_activity_detection=types.AutomaticActivityDetection(
                    start_of_speech_sensitivity=types.StartSensitivity.START_SENSITIVITY_HIGH,
                    end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH,
                    silence_duration_ms=int(cfg.get("voice_silence_duration_ms", 400)),
                )
            ),
        )

    def _handle_show_visual(self, args: dict) -> str:
        """Drive the on-screen visual panel for AI-explained content.

        action 'show' builds/replaces the card; 'next'/'prev' move the on-screen
        highlight in sync with narration; 'clear' returns the screen to the HUD.
        """
        action = (args.get("action") or "show").lower().strip()

        if action == "clear":
            self._visual_card = None
            self._visual_index = 0
            self.ui.clear_visual()
            return "Visual cleared."

        if action in ("next", "prev"):
            card = self._visual_card
            if not card or card.get("kind") != "steps":
                return "There's no step-by-step visual to navigate."
            n = len(card.get("steps") or [])
            if n == 0:
                return "There are no steps to navigate."
            if action == "next":
                self._visual_index = min(self._visual_index + 1, n - 1)
            else:
                self._visual_index = max(self._visual_index - 1, 0)
            card["index"] = self._visual_index
            self.ui.show_visual(card)
            return f"Showing step {self._visual_index + 1} of {n}."

        # action == "show" (default): build a fresh card.
        image = args.get("image_url") or args.get("image_path")
        if image:
            card = {
                "kind": "image",
                "title": args.get("title") or "TRAVIS",
                "caption": args.get("caption") or "",
            }
            if args.get("image_path"):
                card["path"] = args["image_path"]
            if args.get("image_url"):
                card["url"] = args["image_url"]
            self._visual_card = card
            self._visual_index = 0
            self.ui.show_visual(card)
            return "Showing the image on screen."

        steps = args.get("steps") or []
        if not steps:
            return "Nothing to show. Provide steps or an image for the visual."
        card = {
            "kind": "steps",
            "title": args.get("title") or "TRAVIS",
            "steps": [dict(s) for s in steps],
            "index": 0,
        }
        self._visual_card = card
        self._visual_index = 0
        self.ui.show_visual(card)
        return f"Showing a {len(steps)}-step visual on screen. Say 'next' to advance as you explain."

    async def _run_tool_call(
        self, fcs, spoken_text: str = "", reject_reason: str | None = None
    ):
        """Run one tool_call message's function_calls and answer them in a
        single send_tool_response, off the receive loop so barge-in and audio
        keep flowing while a tool runs.

        Command gating: `spoken_text` is the transcript of whatever the user
        just said, captured by the receive loop before Gemini decided to call
        a tool, and `reject_reason` is the receive loop's verdict on it (see
        _mute_reason_for: not awake / noise / not English / false wake). This
        is the hard, code-level backstop in front of CMS execution —
        core/prompt.txt tells Gemini not to call a tool in those cases, but a
        model can misbehave, so nothing here trusts that alone. A rejected
        call is answered silently: no tool runs and nothing is spoken
        (2026-09-24; it used to say "Please speak in English").
        """
        if reject_reason is None and spoken_text and not is_english(
            strip_markers(spoken_text)
        ):
            reject_reason = "not English"
        if reject_reason is not None:
            self._mute_turn(reject_reason)
            print(
                f"[Voice Agent] 🚫 Tool call ignored ({reject_reason}): {spoken_text!r}"
            )
            session = self.session
            fn_responses = [
                types.FunctionResponse(
                    id=fc.id,
                    name=fc.name,
                    response={
                        "result": "Ignored: not an English command addressed "
                        "to you. Do not reply; say nothing.",
                        "silent": True,
                    },
                )
                for fc in fcs
            ]
            try:
                if session is not None and session is self.session:
                    await session.send_tool_response(function_responses=fn_responses)
            except Exception as e:
                print(f"[Voice Agent] ⚠️ send_tool_response failed: {e}")
            return

        # Answer on the session the call arrived on: after a reconnect the new
        # session has no pending call to respond to, so we drop instead.
        session = self.session
        fn_responses = []
        async with self._tool_lock:
            for fc in fcs:
                try:
                    fr = await self._execute_tool(fc)
                except BaseException as e:
                    # A crashed dispatch must still answer, or Gemini Live
                    # hangs waiting for the FunctionResponse.
                    traceback.print_exc()
                    fr = types.FunctionResponse(
                        id=fc.id,
                        name=fc.name,
                        response={"result": f"Tool '{fc.name}' crashed: {e}"},
                    )
                fn_responses.append(fr)
        try:
            if session is not None and session is self.session:
                # Concurrent send while the receive loop iterates is the
                # established pattern here (see _send_realtime).
                await session.send_tool_response(function_responses=fn_responses)
                self._tool_response_sent_at = time.monotonic()
                # Gemini now continues the turn (usually by speaking the
                # result), so any earlier "turn complete" is stale: the
                # exchange isn't finished until a NEW one arrives. This is
                # also what keeps several commands in one request together —
                # each tool response reopens it.
                self._reply_complete_at = None
                self._last_model_activity = time.monotonic()
            else:
                print(
                    "[Voice Agent] ⚠️ Session changed during tool run — dropping tool response."
                )
        except Exception as e:
            print(f"[Voice Agent] ⚠️ send_tool_response failed: {e}")

    async def _execute_tool(self, fc) -> types.FunctionResponse:
        name = fc.name
        args = dict(fc.args or {})

        print(f"[Voice Agent] 🔧 {name}  {args}")
        tool_start = time.monotonic()
        if self._wake_engaged_at is not None:
            # Reported once per wake, on whichever tool call happens first —
            # includes however long the user spent actually talking, not
            # just system overhead, so treat it as a rough end-to-end number
            # rather than a pure latency measurement.
            since_wake_ms = (tool_start - self._wake_engaged_at) * 1000
            print(
                f"[Voice Agent] ⏱️  {since_wake_ms:.0f}ms since wake word (includes your speech)"
            )
            self._wake_engaged_at = None
        self.ui.set_state("THINKING")
        if name == "save_memory":
            category = args.get("category", "notes")
            key = args.get("key", "")
            value = args.get("value", "")
            if key and value:
                update_memory({category: {key: {"value": value}}})
                print(f"[Memory] 💾 save_memory: {category}/{key} = {value}")
            if not self.ui.muted:
                self.ui.set_state("LISTENING")
            return types.FunctionResponse(
                id=fc.id, name=name, response={"result": "ok", "silent": True}
            )

        loop = asyncio.get_event_loop()
        result = "Done."

        try:
            self._tool_active += 1
            try:
                if name == "knowledge_search":
                    query = args.get("query", "")
                    r = await loop.run_in_executor(
                        None, lambda: knowledge_search(query, api_key=_get_api_key())
                    )
                    result = r or "No relevant information found."

                elif name == "list_inventory":
                    r = await loop.run_in_executor(None, lambda: list_inventory(args))
                    result = r or "Done."

                elif name == "show_visual":
                    result = self._handle_show_visual(args)

                elif name == "device_control":
                    self._timing.setdefault("cms_request_started", time.monotonic())
                    r = await loop.run_in_executor(
                        None,
                        lambda: device_control(
                            parameters=args, player=self.ui, speak=self.tool_log
                        ),
                    )
                    self._timing["cms_response_received"] = time.monotonic()
                    result = r or "Done."

                elif name == "screen_control":
                    self._timing.setdefault("cms_request_started", time.monotonic())
                    r = await loop.run_in_executor(
                        None,
                        lambda: screen_control(
                            parameters=args, player=self.ui, speak=self.tool_log
                        ),
                    )
                    self._timing["cms_response_received"] = time.monotonic()
                    result = r or "Done."

                elif name == "shutdown_travis":
                    self.ui.write_log("SYS: Shutdown requested.")
                    self.speak("Goodbye.")

                    def _shutdown():
                        time.sleep(1)
                        self._release_wake_word()
                        os._exit(0)

                    threading.Thread(target=_shutdown, daemon=True).start()
                else:
                    result = f"Unknown tool: {name}"
            finally:
                self._tool_active -= 1

        except Exception as e:
            result = f"Tool '{name}' failed: {e}"
            traceback.print_exc()
            self.speak_error(name, e)

        if not self.ui.muted:
            self.ui.set_state("LISTENING")

        tool_elapsed_ms = (time.monotonic() - tool_start) * 1000
        print(f"[Voice Agent] ⏱️  {name} took {tool_elapsed_ms:.0f}ms")
        print(f"[Voice Agent] 📤 {name} → {str(result)[:80]}")

        return types.FunctionResponse(id=fc.id, name=name, response={"result": result})

    async def _send_realtime(self):
        send_failures = 0
        while True:
            msg = await self.out_queue.get()
            session = self.session
            if session is None:
                # Disconnected (between sessions): drop this frame rather than
                # crashing the task. The run loop will reconnect shortly.
                continue
            try:
                sent_at = time.monotonic()
                await session.send_realtime_input(media=msg)
                send_failures = 0
                took_ms = (time.monotonic() - sent_at) * 1000
                if took_ms > self._max_send_ms:
                    self._max_send_ms = took_ms
                if took_ms > 500:
                    print(
                        f"[Voice Agent] 🐌 Network send stalled {took_ms:.0f}ms "
                        f"({self.out_queue.qsize()} chunks waiting)."
                    )
            except Exception as e:
                # Session dropped mid-send; let the run loop handle reconnect.
                # Was silently swallowed with zero logging — meant a send
                # that started failing on every call (bad session state, a
                # malformed frame, an API-side rejection) looked externally
                # identical to healthy sends with no reply yet, which is
                # exactly the kind of thing that needs to be visible instead
                # of guessed at. Only the first of a run of failures prints,
                # so a real outage doesn't spam the log once a second forever.
                send_failures += 1
                if send_failures == 1:
                    print(f"[Voice Agent] ⚠️ send_realtime_input failed: {e}")
                continue

    _KEEPALIVE_SEC = 8.0

    async def _keepalive(self):
        """Keep the warm Live socket from idling out while on standby.

        Nothing real is streamed to Gemini until the wake word, and the
        server closes an idle socket — the next "Travis" would then pay a
        full reconnect (seconds) before anything could be processed. A
        zeroed frame every few seconds resets that idle timer without
        sending any room audio (zeros, never the mic) and without tripping
        the model's voice-activity detection."""
        silent = {
            "data": b"\x00" * (CHUNK_SIZE * 2 * CHANNELS),
            "mime_type": "audio/pcm",
        }
        while True:
            await asyncio.sleep(self._KEEPALIVE_SEC)
            session = self.session
            # Awake => real audio is already flowing and resetting the timer.
            if session is None or self._awake:
                continue
            try:
                await session.send_realtime_input(media=silent)
            except Exception:
                continue

    async def _idle_watchdog(self):
        """Close this Gemini Live connection once the awake window lapses
        with nothing in flight, instead of staying connected indefinitely.

        TRAVIS should only ever reach Gemini's servers while actually
        addressed — not sit online (even idle) for the life of the process.
        Raises _IdleDisconnect to unwind the connection's TaskGroup; run()
        catches it and goes back to waiting for the next wake word with no
        reconnect backoff, since this isn't a failure."""
        while True:
            await asyncio.sleep(0.5)
            if not self._awake and not self._tool_active:
                raise _IdleDisconnect

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

    async def _listen_audio(self):
        print("[Voice Agent] 🎤 Mic started")
        loop = asyncio.get_event_loop()

        # Rolling preroll buffer: keep the last ~1.0s of audio so single-sentence
        # wake-and-command utterances ("Travis, turn off the lights") don't lose
        # the initial syllables while the wake word was being detected.
        # 16 chunks @ 1024 samples / 16kHz = 1.024s.
        preroll_pcm = self._preroll_pcm

        # TRAVIS_DEBUG_WAKE=1: on standby, print what the wake-word decoder
        # is hearing (rate-limited) — tells "heard speech but not 'travis'"
        # apart from "heard nothing" when a wake word is missed.
        debug_wake = os.getenv("TRAVIS_DEBUG_WAKE") == "1"
        dbg = {"last": "", "t": 0.0}

        def _safe_enqueue(item):
            # This runs whether or not a Gemini session currently exists —
            # mic capture is now a persistent, standalone task (see run())
            # so the wake-word detector below works before the first
            # connection too. No session yet => buffer for run() to flush
            # once out_queue exists (see _enqueue_out's docstring for why).
            self._enqueue_out(item)

        def callback(indata, frames, time_info, status):
            with self._speaking_lock:
                travis_speaking = self._is_speaking
                tool_active = self._tool_active

            data = indata.tobytes()
            preroll_pcm.append(data)
            # Set below when this exact chunk gets flushed as the tail of
            # preroll_pcm on a fresh wake — the "stream while awake" block
            # further down must not send it again this same callback, or
            # whatever word straddles that chunk gets duplicated in the
            # command audio (found live: "Travis, can you hear me" came out
            # "Travis can CAN you hear me" — the wake-triggering chunk was
            # going out via the preroll flush AND the per-chunk streamer in
            # the same invocation, since self._awake flips true in between).
            just_flushed_in_preroll = False

            # Local wake-word pass (only meaningful while a detector exists and
            # we're not playing the agent's own audio back into the mic).
            if not travis_speaking and not tool_active and not self.ui.muted:
                if self._detect_wake_word(data):
                    if not self._awake:
                        # Real-mic wake lag: walk back from the newest chunk
                        # through the contiguous voiced run to where it began.
                        # "Voiced" is relative to this room's noise floor (the
                        # quietest chunk in the pre-roll), not a fixed level —
                        # a fixed cutoff read a quiet mic as never voiced.
                        levels = [_chunk_rms(c) for c in preroll_pcm]
                        cutoff = max(min(levels) * 3.0, 0.002)
                        voiced = 0
                        for lvl in reversed(levels):
                            if lvl < cutoff:
                                break
                            voiced += 1
                        print(
                            "[Voice Agent] 🟢 Wake word — engaged "
                            f"(~{voiced * CHUNK_SIZE * 1000 // SEND_SAMPLE_RATE}ms after speech onset)."
                        )
                        self.ui.set_state("LISTENING")
                        self._play_chime()
                        self._wake_engaged_at = time.monotonic()
                        # Per-exchange latency stages (see _print_timing_report):
                        # wake detected now, command mode starts right after
                        # the pre-roll is flushed below.
                        self._timing = {"wake_detected": self._wake_engaged_at}
                        # A fresh exchange: nothing answered yet, nobody nudged.
                        self._exchange_active = False
                        self._exchange_is_nudge = False
                        self._reply_complete_at = None
                        self._nudge_state = "none"
                        self._mute_extra_replies = False
                        self._wake_transcript = ""
                        self._wake_confirmed = False
                        self._heard_command_speech = False
                        self._voiced_cutoff = cutoff
                        self._last_voiced_at = time.monotonic()
                        self._wake_stats = {
                            "sent": len(preroll_pcm),
                            "drop_speaking": 0,
                            "drop_tool": 0,
                            "drop_full": 0,
                        }
                        self._max_send_ms = 0.0
                        self._timing["command_mode_started"] = time.monotonic()
                        # Kick off ElevenLabs' TLS+auth handshake now, in the
                        # background, so it overlaps with the user speaking
                        # their command instead of starting cold after Gemini
                        # responds. Safe every wake word: ensure_session()
                        # no-ops once a session is already open. self.elevenlabs
                        # can be None (gemini_live engine, or a wake right as a
                        # connection is still being established) — skip
                        # silently in that case.
                        if self.elevenlabs is not None:
                            asyncio.run_coroutine_threadsafe(
                                self.elevenlabs.prewarm(), loop
                            )
                        # ponytail: flush pre-roll audio so single-breath "Travis <command>" preserves opening words
                        self._timing["preroll_flush_started"] = time.monotonic()
                        for chunk in preroll_pcm:
                            loop.call_soon_threadsafe(
                                _safe_enqueue,
                                {"data": chunk, "mime_type": "audio/pcm"},
                            )
                        self._timing["preroll_flush_completed"] = time.monotonic()
                        just_flushed_in_preroll = True
                    self._awake = True
                    self._awake_until = time.monotonic() + self._awake_timeout
                    if self._extract_active:
                        # Off the audio thread: speaker.embed() is a real
                        # neural-net forward pass (measured: up to ~750ms on
                        # a cold first call in a fresh process) — calling it
                        # inline here would block the audio driver's own
                        # callback for that whole time, risking dropped mic
                        # frames. The worker already has a "wake" handler for
                        # exactly this; _extract_gain_target starts at 1.0,
                        # so audio keeps flowing at full volume regardless of
                        # how long enrollment takes.
                        try:
                            self._extract_q.put_nowait(
                                ("wake", b"".join(preroll_pcm))
                            )
                        except queue.Full:
                            pass
                    if self.session is None and self._reconnect_now is not None:
                        loop.call_soon_threadsafe(self._reconnect_now.set)

            elif self._wake_model is not None and not self.ui.muted:
                # Travis is speaking or a tool is running, so a wake word is
                # deliberately not acted on (his own voice must not trigger
                # it). Keep the decoder fed anyway — skipping chunks leaves
                # it resuming from stale state — and say so if "Travis" was
                # heard in the meantime, since that looks identical to a
                # missed wake word from the outside.
                if self._wake_model.detect(data):
                    print(
                        "[Voice Agent] 🔕 Wake word heard while Travis was "
                        "speaking / busy — ignored."
                    )

            if debug_wake and not self._awake and self._wake_model is not None:
                partial = getattr(self._wake_model, "last_partial", "")
                now = time.monotonic()
                if partial and partial != dbg["last"] and now - dbg["t"] > 1.0:
                    dbg["last"], dbg["t"] = partial, now
                    print(f"[Voice Agent] 👂 Decoder hears: {partial!r}")

            # Track when the user is actually talking, so "Travis" followed by
            # 2 seconds of silence can be told apart from a command in progress.
            now = time.monotonic()
            if (
                self._awake
                and not travis_speaking
                and _chunk_rms(data) >= self._voiced_cutoff
            ):
                self._last_voiced_at = now
                if self._nudge_state == "done":
                    self._mute_extra_replies = False

            # One request per wake word. The mic closes only when the whole
            # exchange is over (see _awake_action); if nothing follows the
            # wake word, Travis asks what the user wants, then gives up.
            q = self.audio_in_queue
            busy = travis_speaking or bool(tool_active) or (q is not None and not q.empty())
            action = self._awake_action(now, busy)
            if action == "standby":
                self._enter_standby(
                    "request answered" if self._exchange_active else "no request heard"
                )
                if not self.ui.muted:
                    self.ui.set_state("THINKING")
            elif action == "nudge":
                self._nudge_state = "sent"
                self._exchange_is_nudge = True
                print("[Voice Agent] 🙋 No command after the wake word — asking what you need.")
                self.speak(self._NUDGE_TEXT)
            elif action == "wait_for_command":
                # The prompt has been spoken; keep the mic open for the real
                # request (no second "Travis" needed) and start a fresh wait.
                self._exchange_active = False
                self._exchange_is_nudge = False
                self._reply_complete_at = None
                self._nudge_state = "done"
                self._last_voiced_at = now
                self._awake_until = now + self._awake_timeout
                print(
                    "[Voice Agent] 🟡 Prompt spoken — listening for your request "
                    "(no need to say Travis again)."
                )

            # Count audio that can't be sent right now, for the standby summary.
            if self._awake and not self.ui.muted and not self._extract_active:
                if tool_active:
                    self._wake_stats["drop_tool"] += 1
                elif travis_speaking:
                    self._wake_stats["drop_speaking"] += 1

            # Stream to Gemini only while awake and not muted/busy with a tool.
            # not just_flushed_in_preroll: this exact chunk already went out
            # as the tail of preroll_pcm a few lines up on a fresh wake —
            # sending it again here would duplicate whatever word straddles
            # it (see just_flushed_in_preroll's definition above).
            if (
                self._awake
                and not tool_active
                and not self.ui.muted
                and not just_flushed_in_preroll
            ):
                if self._extract_active:
                    # Continuous target-speaker extraction: every chunk is
                    # forwarded, always — never blocked or delayed waiting on
                    # verification — just scaled by however well the last
                    # analyzed window matched the enrolled voice. Gain ramps
                    # (not steps) toward the worker's latest estimate each
                    # callback so volume changes fade instead of clicking.
                    # Runs even while TRAVIS is speaking: pure TTS echo scores
                    # far below the (relaxed, see the worker) match bar and
                    # gets suppressed, while genuine barge-in still gets
                    # through — the same barge-in behavior the old gate had.
                    self._extract_gain_applied += (
                        self._extract_gain_target - self._extract_gain_applied
                    ) * 0.35
                    scaled = _apply_gain(data, self._extract_gain_applied)
                    self._timing.setdefault(
                        "first_extracted_chunk_sent", time.monotonic()
                    )
                    self._wake_stats["sent"] += 1
                    loop.call_soon_threadsafe(
                        _safe_enqueue, {"data": scaled, "mime_type": "audio/pcm"}
                    )
                    try:
                        self._extract_q.put_nowait(("audio", data))
                    except queue.Full:
                        pass
                elif not travis_speaking:
                    self._wake_stats["sent"] += 1
                    loop.call_soon_threadsafe(
                        _safe_enqueue, {"data": data, "mime_type": "audio/pcm"}
                    )

        cfg = _load_api_config()
        input_device = _resolve_input_device(cfg.get("mic_device_name", ""))

        # A mic-driver hiccup (device busy, momentarily unplugged, a transient
        # PortAudio error — the kind seen in practice as PaErrorCode -9999)
        # used to propagate out of this coroutine, which tears down the whole
        # asyncio.TaskGroup and forces a full Gemini Live reconnect: a lost
        # websocket, a lost conversation, and dropped wake-word state, all to
        # fix what's usually a purely local audio problem. Retry opening the
        # stream here instead — mirrors _play_audio's degrade-and-continue
        # pattern, except recovery here means the mic starts working again
        # rather than staying silent, since there's no "session without a mic"
        # equivalent to "session without speakers".
        backoff = 1.0
        while True:
            try:
                with sd.InputStream(
                    device=input_device,
                    samplerate=SEND_SAMPLE_RATE,
                    channels=CHANNELS,
                    dtype="int16",
                    blocksize=CHUNK_SIZE,
                    callback=callback,
                ):
                    print("[Voice Agent] 🎤 Mic stream open")
                    backoff = 1.0
                    while True:
                        await asyncio.sleep(0.1)
            except Exception as e:
                print(f"[Voice Agent] ⚠️ Mic error ({e}). Retrying in {backoff:.0f}s...")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30.0)

    async def _receive_audio(self):
        print("[Voice Agent] 👂 Recv started")
        out_buf, in_buf, model_text_buf = [], [], []
        got_any_response = False

        try:
            while True:
                async for response in self.session.receive():
                    if not got_any_response:
                        got_any_response = True
                        print(
                            f"[Voice Agent] 👂 First response from Gemini "
                            f"(server_content={response.server_content is not None}, "
                            f"tool_call={response.tool_call is not None})"
                        )
                    audio_data = _live_response_audio_data(response)
                    if audio_data:
                        # Gemini's own built-in audio (fallback when ElevenLabs
                        # isn't active) — commented out for now, ElevenLabs only.
                        # if not self._mute_extra_replies and self.elevenlabs is None:
                        #     self.audio_in_queue.put_nowait(audio_data)
                        self._on_model_activity()

                    if response.server_content:
                        sc = response.server_content

                        if sc.interrupted:
                            print(
                                "[Voice Agent] ✋ Interrupted (barge-in) — draining audio"
                            )
                            # User barged in: drop the buffered tail audio and
                            # release the mic gate immediately so the agent
                            # stops talking over the user.
                            self._drain_audio_queue()
                            self.set_speaking(False)
                            # The reply was cut off, so the exchange is NOT
                            # finished: keep the mic open for what the user
                            # says next instead of closing on a half-said
                            # sentence.
                            self._reply_complete_at = None
                            if self._awake:
                                self._awake_until = max(
                                    self._awake_until,
                                    time.monotonic() + self._awake_timeout,
                                )
                            out_buf = []
                            model_text_buf = []
                            continue

                        if sc.output_transcription and sc.output_transcription.text:
                            # Re-checked on every chunk: the user's transcript
                            # can still be arriving when the reply starts.
                            reason = self._mute_reason_for(" ".join(in_buf))
                            if reason is not None:
                                self._mute_turn(reason)
                            txt = sc.output_transcription.text.strip()
                            if txt:
                                out_buf.append(txt)
                            if self._turn_mute_reason is None:
                                self.set_speaking(True)
                                if (
                                    txt
                                    and self.elevenlabs is not None
                                    and not self._mute_extra_replies
                                ):
                                    asyncio.create_task(
                                        self.elevenlabs.send_text(sc.output_transcription.text + " ")
                                    )

                        if sc.model_turn:
                            for part in sc.model_turn.parts or []:
                                if getattr(part, "thought", False):
                                    continue  # reasoning summary, not speech
                                txt = getattr(part, "text", None)
                                if txt and txt.strip():
                                    model_text_buf.append(txt.strip())

                        if sc.input_transcription and sc.input_transcription.text:
                            txt = sc.input_transcription.text.strip()
                            if txt:
                                in_buf.append(txt)
                                self._last_input_transcription_at = time.monotonic()
                                if self._awake:
                                    self._wake_transcript += " " + txt
                                    label = self._wake_model.label if self._wake_model else "travis"
                                    if mentions_wake_word(self._wake_transcript, label):
                                        self._wake_confirmed = True
                                    if has_speech_beyond_wake_word(self._wake_transcript, label):
                                        self._heard_command_speech = True
                                # vad_speech_end (approx): Gemini Live doesn't
                                # expose a separate "user stopped talking"
                                # event, only streamed transcript chunks — the
                                # last one before the model responds stands in
                                # for it. Last-wins (overwritten on every
                                # chunk), not setdefault.
                                self._timing["vad_speech_end"] = (
                                    self._last_input_transcription_at
                                )

                        if sc.turn_complete:
                            if self.elevenlabs is not None:
                                asyncio.create_task(self.elevenlabs.flush())
                            # Note: Deliberately do NOT call self.set_speaking(False) here.
                            # The server finished streaming audio frames, but playback in _play_audio
                            # is still actively writing audio chunks to the speakers!
                            # _play_audio clears speaking state once the audio has physically played + echo cooldown.
                            self._last_input_transcription_at = None
                            self._reply_complete_at = time.monotonic()
                            muted = self._turn_mute_reason
                            self._turn_mute_reason = None
                            if muted in ("noise", "not English") and self._awake:
                                # Ignored, not answered: keep waiting for a
                                # real command until the awake window ends.
                                self._exchange_active = False
                                self._reply_complete_at = None
                            if self._exchange_is_nudge and not muted:
                                # The prompt is answered; a second answer to the
                                # same wake word must not be spoken.
                                self._mute_extra_replies = True
                            # ponytail: while awake, open extraction back up for
                            # the user's follow-up command — the continuous
                            # design has no separate "grace" counter to re-arm,
                            # so this just resets gain to full until the next
                            # analysis window judges it, the same effect the
                            # old gate's grace re-arm had.
                            if self._awake and self._extract_active:
                                self._extract_gain_target = 1.0
                                self._extract_gain_applied = 1.0

                            full_in = " ".join(in_buf).strip()
                            if full_in:
                                self.ui.write_log(f"You: {full_in}")
                                print(f"[Voice Agent] 🗣️  You: {full_in}")
                            in_buf = []

                            # Prefer complete model_turn text if present to avoid duplicating with streaming output_transcription
                            full_out = " ".join(model_text_buf).strip() if model_text_buf else " ".join(out_buf).strip()
                            if full_out and muted:
                                print(f"[Voice Agent] 🔇 Not spoken ({muted}): {full_out}")
                            elif full_out:
                                self.ui.write_log(f"TRAVIS: {full_out}")
                                print(f"[Voice Agent] 💬 TRAVIS: {full_out}")
                            out_buf = []
                            model_text_buf = []

                            if full_in and len(full_in) > 5 and not muted:
                                threading.Thread(
                                    target=_update_memory_async,
                                    args=(full_in, full_out),
                                    daemon=True,
                                ).start()

                    if response.tool_call:
                        self._on_model_activity()
                        if self._last_input_transcription_at is not None:
                            gap_ms = (
                                time.monotonic() - self._last_input_transcription_at
                            ) * 1000
                            print(
                                f"[Voice Agent] ⏱️  {gap_ms:.0f}ms from end of your speech to tool call received"
                            )
                            self._last_input_transcription_at = None
                        fcs = list(response.tool_call.function_calls or [])
                        for fc in fcs:
                            print(f"[Voice Agent] 📞 {fc.name}")
                        # Fire-and-forget so this receive loop keeps handling
                        # barge-in/audio while the tool runs. Not in the
                        # TaskGroup: it would cancel mid-tool on exit; the
                        # session guard in _run_tool_call handles staleness.
                        spoken_text = " ".join(in_buf).strip()
                        reason = self._mute_reason_for(spoken_text)
                        if reason is not None:
                            self._mute_turn(reason)
                        task = asyncio.create_task(
                            self._run_tool_call(
                                fcs, spoken_text, reject_reason=self._turn_mute_reason
                            )
                        )
                        self._tool_tasks.add(task)
                        task.add_done_callback(self._tool_tasks.discard)

        except Exception as e:
            print(f"[Voice Agent] ❌ Recv: {e}")
            traceback.print_exc()
            raise

    def _open_output_stream(self, cfg: dict):
        output_device = _resolve_output_device(
            cfg.get("speaker_device_name", ""),
            avoid_hint=cfg.get("mic_device_name", ""),
        )
        stream = sd.RawOutputStream(
            device=output_device,
            samplerate=RECEIVE_SAMPLE_RATE,
            channels=CHANNELS,
            dtype="int16",
            blocksize=CHUNK_SIZE,
        )
        stream.start()
        return stream

    def _play_chime(self):
        """Short two-note "I'm listening" tone right after the wake word, so the
        user knows to speak the command. Fire-and-forget on its own thread;
        any failure is swallowed (the agent works fine without it)."""
        cfg = _load_api_config()
        if not cfg.get("audio_output_enabled", True) or not cfg.get("wake_chime", True):
            return

        def _run():
            try:
                rate = RECEIVE_SAMPLE_RATE
                gain = max(0.0, float(cfg.get("speaker_gain", 1.0)))
                t = np.arange(int(rate * 0.09)) / rate
                fade = np.minimum(1.0, np.minimum(t, t[::-1]) / 0.01)
                notes = [np.sin(2 * np.pi * f * t) * fade for f in (880.0, 1320.0)]
                wave = np.concatenate(notes) * 0.25 * gain
                pcm = (np.clip(wave, -1.0, 1.0) * 32767).astype(np.int16)
                device = _resolve_output_device(
                    cfg.get("speaker_device_name", ""),
                    avoid_hint=cfg.get("mic_device_name", ""),
                )
                sd.play(pcm, samplerate=rate, device=device)
            except Exception as e:
                print(f"[Voice Agent] ⚠️ Wake chime failed: {e}")

        threading.Thread(target=_run, daemon=True).start()

    async def _play_audio(self):
        cfg = _load_api_config()
        output_enabled = bool(cfg.get("audio_output_enabled", True))
        # Software volume boost on top of the OS/device volume (1.0 = off).
        gain = max(0.0, float(cfg.get("speaker_gain", 1.0)))
        stream = None
        if output_enabled:
            try:
                stream = self._open_output_stream(cfg)
                print("[Voice Agent] 🔊 Play started")
            except Exception as e:
                print(
                    f"[Voice Agent] ⚠️ Local playback unavailable ({e}). Continuing without spoken audio."
                )
        else:
            # The CMS/room audio system owns audible output: discard TTS
            # locally but keep draining the queue so it doesn't grow and the
            # speaking flag still resets.
            print(
                "[Voice Agent] 🔇 Local playback disabled (audio_output_enabled=false)"
                " — the room audio system handles audio out."
            )
        try:
            while True:
                try:
                    chunk = await asyncio.wait_for(
                        self.audio_in_queue.get(), timeout=0.2
                    )
                except asyncio.TimeoutError:
                    # No audio for 200ms => playback has finished draining.
                    with self._speaking_lock:
                        was_speaking = self._is_speaking
                    if was_speaking:
                        # Wait for DAC / PortAudio hardware buffer and acoustic room reverb to decay
                        await asyncio.sleep(0.4)
                        self._clear_preroll()
                        self.set_speaking(False)
                    continue
                if self._tool_response_sent_at is not None:
                    elapsed_ms = (time.monotonic() - self._tool_response_sent_at) * 1000
                    print(
                        f"[Voice Agent] ⏱️  {elapsed_ms:.0f}ms from tool response to spoken reply"
                    )
                    self._tool_response_sent_at = None
                # First audio chunk received (from ElevenLabs) this exchange.
                self._timing.setdefault("first_audio_chunk_received", time.monotonic())
                if stream is None:
                    continue
                self.set_speaking(True)
                try:
                    # A hung write (observed in practice: PortAudio/WASAPI
                    # wedged after another process fought over the same
                    # output device — e.g. a previous, forcefully-killed
                    # instance) would otherwise block this coroutine forever.
                    # That's not just silence: mic-callback's standby
                    # transition and _idle_watchdog both refuse to act while
                    # set_speaking(True), so a stuck write here wedges the
                    # *whole* session open indefinitely, immune to the awake
                    # timeout, with no visible error. A timeout can't force
                    # the underlying OS-level write to actually stop (Python
                    # can't kill a thread), but abandoning it and dropping
                    # the stream at least lets the agent recover instead of
                    # hanging forever.
                    await asyncio.wait_for(
                        asyncio.to_thread(stream.write, _apply_gain(chunk, gain)),
                        timeout=5.0,
                    )
                    # playback_started: audio actually starts this exchange —
                    # the last stage tracked, so print the breakdown right
                    # here, once, the first time audio actually plays.
                    if (
                        "wake_detected" in self._timing
                        and "playback_started" not in self._timing
                    ):
                        self._timing["playback_started"] = time.monotonic()
                        if os.getenv("TRAVIS_DEBUG_WAKE") == "1":
                            s = np.frombuffer(chunk, dtype=np.int16)
                            print(
                                f"[Voice Agent] 🔊 first reply chunk: {len(chunk)}B, "
                                f"peak={int(np.max(np.abs(s))) if s.size else 0}/32767, "
                                f"gain={gain}, stream active={stream.active}"
                            )
                        self._print_timing_report()
                except Exception as e:
                    # A local audio-driver hiccup (seen in practice: a transient
                    # Windows/PortAudio "no driver installed" error on write,
                    # unrelated to the mic/wake-word/Gemini pipeline) shouldn't
                    # tear down the whole session — degrade to silent for the
                    # rest of this connection rather than forcing a reconnect
                    # that drops the wake-word state and conversation context.
                    label = "timed out" if isinstance(e, asyncio.TimeoutError) else f"failed ({e})"
                    print(f"[Voice Agent] ⚠️ Playback write {label}. Continuing without spoken audio.")
                    try:
                        stream.stop()
                        stream.close()
                    except Exception:
                        pass
                    stream = None
                    self.set_speaking(False)
        finally:
            self.set_speaking(False)
            if stream is not None:
                stream.stop()
                stream.close()

    # Reconnect backoff: start small, grow on repeated failures so we don't
    # hammer the API during an outage, but recover fast after a single blip.
    _BACKOFF_MIN = 3.0
    _BACKOFF_MAX = 60.0
    # A session that stayed up at least this long counts as "healthy", so the
    # next failure restarts from the minimum delay instead of a grown one.
    _BACKOFF_RESET_AFTER = 30.0

    @staticmethod
    def _is_timeout(exc: BaseException) -> bool:
        """True if exc (or anything inside a TaskGroup ExceptionGroup) is a
        connection timeout / handshake failure."""
        if isinstance(exc, BaseExceptionGroup):
            return any(TravisLive._is_timeout(e) for e in exc.exceptions)
        return isinstance(exc, TimeoutError) or "opening handshake" in str(exc).lower()

    @staticmethod
    def _is_idle_disconnect(exc: BaseException) -> bool:
        """True if exc (or anything inside a TaskGroup ExceptionGroup) is
        _idle_watchdog's deliberate, non-error disconnect."""
        if isinstance(exc, BaseExceptionGroup):
            return any(TravisLive._is_idle_disconnect(e) for e in exc.exceptions)
        return isinstance(exc, _IdleDisconnect)

    async def run(self):
        client = genai.Client(
            api_key=_get_api_key(), http_options={"api_version": "v1beta"}
        )

        backoff = self._BACKOFF_MIN
        self._reconnect_now = asyncio.Event()
        # The event loop is constant for the process's whole lifetime (one
        # asyncio.run() call wraps everything) — set once here rather than
        # per-connection, so the mic callback's extraction forwarding (and
        # _enqueue_out's pending-audio buffer) can schedule onto it even
        # before the first connection.
        self._loop = asyncio.get_event_loop()

        # Mic capture + local (Vosk/openWakeWord) wake-word detection are
        # fully offline and run for the whole process lifetime, independent
        # of Gemini connection state — this is what lets the loop below wait
        # for "Travis" before ever dialing out. Starting this once, here,
        # rather than per-connection, also means a reconnect no longer tears
        # down and restarts the mic stream.
        asyncio.create_task(self._listen_audio())

        while True:
            connected_at = None
            try:
                print("[Voice Agent] 🔌 Connecting to Gemini Live (warm connection)...")
                self.ui.set_state("THINKING")
                self.ui.set_connection("connecting")
                config = self._build_config()

                async with (
                    client.aio.live.connect(model=LIVE_MODEL, config=config) as session,
                    asyncio.TaskGroup() as tg,
                ):
                    self.session = session
                    self.audio_in_queue = asyncio.Queue()
                    self.out_queue = asyncio.Queue(maxsize=self._PENDING_AUDIO_MAX_CHUNKS)

                    cfg = _load_api_config()
                    el_key = cfg.get("elevenlabs_api_key", "").strip()
                    el_voice = cfg.get("elevenlabs_voice_id", "").strip()
                    el_model = cfg.get("elevenlabs_model_id", "eleven_flash_v2_5").strip()
                    tts_engine = cfg.get("tts_engine", "elevenlabs" if (el_key and el_voice) else "gemini_live")

                    if tts_engine == "elevenlabs" and el_key and el_voice:
                        from core.elevenlabs_stream import ElevenLabsStreamer
                        self.elevenlabs = ElevenLabsStreamer(
                            api_key=el_key,
                            voice_id=el_voice,
                            model_id=el_model,
                            sample_rate=RECEIVE_SAMPLE_RATE,
                            audio_queue=self.audio_in_queue,
                        )
                        print(f"[Voice Agent] 🎙️ ElevenLabs TTS active (voice: {el_voice}, model: {el_model}).")
                    else:
                        self.elevenlabs = None
                        # Fallback path (Gemini's own built-in audio) is disabled
                        # for now — see the commented-out block in the receive
                        # loop above. Without ElevenLabs configured, TRAVIS
                        # currently has no spoken audio at all.
                        print(
                            "[Voice Agent] ⚠️ ElevenLabs not configured — "
                            "Gemini fallback voice is disabled, no spoken audio."
                        )

                    # Flush whatever was captured before the connection opened
                    pending, self._pending_audio = self._pending_audio, []
                    for item in pending:
                        try:
                            self.out_queue.put_nowait(item)
                        except asyncio.QueueFull:
                            break
                    if pending:
                        print(f"[Voice Agent] 🧊 Flushed {len(pending)} buffered audio chunk(s).")

                    # One id per connection, sent on every device/screen
                    # command this session issues — apps/api's audit log
                    # groups by this so a shared room mic's history reads as
                    # distinct conversations instead of one flat list.
                    cms_client.set_session_id(str(uuid.uuid4()))

                    connected_at = time.monotonic()
                    print("[Voice Agent] ✅ Connected (warm line ready).")
                    wake_label = (
                        self._wake_model.label if self._wake_model else "travis"
                    )
                    if self._awake:
                        self.ui.set_state("LISTENING")
                    else:
                        print(f"[Voice Agent] 🟠 Standby — say '{wake_label}' to talk.")
                        self.ui.set_state("THINKING")
                    self.ui.set_connection("online")
                    self.ui.write_log("SYS: Voice agent online (warm connection).")

                    tg.create_task(self._send_realtime())
                    tg.create_task(self._keepalive())
                    tg.create_task(self._receive_audio())
                    tg.create_task(self._play_audio())

            except Exception as e:
                if self._is_timeout(e):
                    print(
                        "[Voice Agent] ⚠️ Gemini Live connection timed out. "
                        "Check internet/VPN/firewall/API key, then it will retry."
                    )
                    if os.getenv("TRAVIS_DEBUG_TRACEBACK"):
                        traceback.print_exc()
                else:
                    print(f"[Voice Agent] ⚠️ {e}")
                    traceback.print_exc()

            if self.elevenlabs is not None:
                await self.elevenlabs.cancel()
                self.elevenlabs = None
            self.session = None
            self.set_speaking(False)
            self.ui.write_log("SYS: Voice agent offline.")
            self.ui.set_connection("offline")

            # A healthy session that dropped recovers fast; a connect that
            # failed quickly backs off exponentially (with jitter) up to the cap.
            healthy = (
                connected_at is not None
                and (time.monotonic() - connected_at) >= self._BACKOFF_RESET_AFTER
            )
            if healthy:
                backoff = self._BACKOFF_MIN

            delay = backoff + random.uniform(0, backoff * 0.25)
            print(f"[Voice Agent] 🔄 Reconnecting in {delay:.1f}s...")
            # Wait out the backoff, but cut it short if the wake word fires —
            # then the user who just said "Travis" reconnects right away.
            self._reconnect_now.clear()
            try:
                await asyncio.wait_for(self._reconnect_now.wait(), timeout=delay)
                print("[Voice Agent] ⚡ Wake word during standby — reconnecting now.")
            except asyncio.TimeoutError:
                pass
            backoff = min(backoff * 2, self._BACKOFF_MAX)


def main():
    _prefer_ipv4_for_gemini_live()
    ui = TravisUI("face.png")

    def runner():
        try:
            ui.wait_for_api_key()

            # Warm the knowledge index in the background so the first
            # knowledge_search doesn't pay a full synchronous rebuild.
            def _warm_rag():
                try:
                    from rag import retriever

                    retriever.warm_index(_get_api_key())
                except Exception as e:
                    print(f"[Voice Agent] ⚠️ RAG warm-up skipped: {e}")

            threading.Thread(target=_warm_rag, daemon=True, name="rag-warm").start()

            travis = TravisLive(ui)
            asyncio.run(travis.run())
        except KeyboardInterrupt:
            print("\n🔴 Shutting down...")
        except Exception as e:
            # Anything raised here happens BEFORE TravisLive.run()'s own
            # reconnect loop takes over — a bad/missing API key, a UI init
            # failure, anything in wait_for_api_key() — and used to be caught
            # only by Python's default thread excepthook: a traceback printed
            # to a console nobody may be watching, then this daemon thread
            # quietly dies while the Tk window keeps running as if nothing
            # happened — frozen, with no voice backend and no visible reason
            # why. Surface it loudly instead, in both places someone might
            # actually be looking: the console and the on-screen log/status.
            print(f"[Voice Agent] 🛑 FATAL — voice backend crashed at startup: {e}")
            traceback.print_exc()
            try:
                ui.set_connection("offline")
                ui.write_log(f"SYS: FATAL — voice backend crashed: {e}")
            except Exception:
                pass

    threading.Thread(target=runner, daemon=True).start()
    ui.root.mainloop()


if __name__ == "__main__":
    main()
