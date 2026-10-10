"""Paths, audio constants and the config loader shared by every part of the voice agent."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def get_base_dir():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent


BASE_DIR = get_base_dir()


API_CONFIG_PATH = Path(os.environ["TRAVIS_CONFIG"]) if os.environ.get("TRAVIS_CONFIG") else BASE_DIR / "config" / "api_keys.json"  # TRAVIS_CONFIG=config/test_safe.json for mock-only runs


LOCAL_PROMPT_PATH = BASE_DIR / "nlu" / "prompt_local.txt"


PLANNER_PROMPT_PATH = BASE_DIR / "nlu" / "prompt_planner.txt"


COMMANDS_PATH = BASE_DIR / "config" / "commands.json"


CHANNELS = 1


SEND_SAMPLE_RATE = 16000


DEFAULT_TTS_SAMPLE_RATE = 24000


CHUNK_SIZE = 1024


_api_config_cache: "tuple[float, dict] | None" = None


def load_api_config() -> dict:
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
        "ELEVENLABS_API_KEY": "elevenlabs_api_key",
        "ELEVENLABS_VOICE_ID": "elevenlabs_voice_id",
        "ELEVENLABS_MODEL_ID": "elevenlabs_model_id",
        "CMS_VOICE_SECRET": "cms_voice_secret",
        "VOICE_AGENT_SECRET": "cms_voice_secret",
        "CMS_API_BASE_URL": "cms_api_base_url",
        "TRAVIS_ENDPOINTING": "endpointing",  # "smart" | "webrtc": try the new end-of-speech detector without editing the config
    }
    for env_key, conf_key in env_mapping.items():
        val = os.getenv(env_key)
        if val:
            data[conf_key] = val

    _api_config_cache = (mtime, data)
    return data


def _tts_sample_rate() -> int:
    """`tts_sample_rate` from the config: the one rate ElevenLabs is asked for (pcm_<rate>), the
    speaker stream opens at, the chime is synthesised at and the output-device resolver prefers."""
    try:
        rate = int(load_api_config().get("tts_sample_rate", DEFAULT_TTS_SAMPLE_RATE))
    except (TypeError, ValueError):
        return DEFAULT_TTS_SAMPLE_RATE
    # ElevenLabs only offers a few PCM rates; anything else would be a 400 on the websocket.
    return rate if rate in (8000, 16000, 22050, 24000, 44100) else DEFAULT_TTS_SAMPLE_RATE


RECEIVE_SAMPLE_RATE = _tts_sample_rate()


