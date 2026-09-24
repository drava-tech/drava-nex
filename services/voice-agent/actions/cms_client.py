"""HTTP client for cms-platform's internal voice-command API.

This service's device_control and screen_control tools (actions/device_control.py,
actions/screen_control.py) both go through this one client: it owns config
loading, the shared-secret header, and a short-lived cache of devices/
screens/experiences/media for name resolution, so a spoken target ("the
lobby lights", "screen 2") doesn't need its own network round trip.

apps/api is the sole source of truth — this module never holds or mutates
state itself; every command is a synchronous HTTP call whose result is
exactly whatever apps/api decided to do (including its own "which one did
you mean?" clarification when a target is ambiguous — see
apps/api/src/services/voice-actions.ts's resolveByName).
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any, Optional

# pyrefly: ignore [missing-import]
import requests

BASE_DIR = Path(__file__).resolve().parents[1]
API_CONFIG_PATH = BASE_DIR / "config" / "api_keys.json"

_NAME_CACHE_TTL_SEC = 30.0
_name_cache: dict[str, tuple[float, list[dict]]] = {}

# One persistent session for every call this process makes. A bare
# requests.request(...) opens (and TLS-negotiates, on https targets) a brand
# new connection per call — for a local voice command that happens on every
# single utterance, that's a fixed, avoidable tax. A Session reuses one
# keep-alive connection to apps/api instead.
_session = requests.Session()

# Groups every command from one continuous wake-to-sleep interaction in
# apps/api's audit log (voice_command_log.session_id). Set once per Gemini
# Live connection by main.py (see TravisLive.run()'s reconnect loop) so a
# fresh connection — which has no memory of whatever conversation came
# before it — also starts a fresh session id, rather than every command this
# process ever issues looking like one flat, undifferentiated history.
_session_id: str | None = None


def set_session_id(session_id: str | None) -> None:
    global _session_id
    _session_id = session_id


class CmsClientError(Exception):
    """Raised for any cms-platform call that TRAVIS should speak back as an error."""


def _load_config() -> dict:
    try:
        with open(API_CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _base_url() -> str:
    # Default is an IPv4 literal, not "localhost" — deliberately. This
    # machine's networking is IPv6-broken (see main.py's forced IPv4 for
    # Gemini and CLAUDE.md), so "localhost" resolves to both ::1 and
    # 127.0.0.1 and urllib3 tries them in sequence, silently doubling every
    # connection attempt (measured: ~2s per address when the CMS is down, so
    # ~4s per attempt, ~8.3s once _request()'s one retry is included — a
    # requests-level `timeout=` change alone can't fix this, only skipping
    # the wasted IPv6 attempt does).
    return str(
        _load_config().get("cms_api_base_url", "http://127.0.0.1:4000")
    ).rstrip("/")


def _secret() -> str:
    return str(_load_config().get("cms_voice_secret", ""))


_RETRYABLE_EXCEPTIONS = (requests.ConnectionError, requests.Timeout)
_RETRY_DELAY_SEC = 0.3


def _request(
    method: str,
    path: str,
    json_body: Optional[dict] = None,
    idempotency_key: Optional[str] = None,
) -> Any:
    secret = _secret()
    if not secret:
        raise CmsClientError(
            "CMS voice control isn't configured yet — set cms_voice_secret in config/api_keys.json."
        )
    url = f"{_base_url()}/api/internal/voice{path}"
    headers = {"x-voice-secret": secret}
    if idempotency_key:
        headers["x-idempotency-key"] = idempotency_key
    if _session_id:
        headers["x-session-id"] = _session_id

    # One bounded retry on a transient network failure (timeout, connection
    # reset) — a single Wi-Fi blip used to surface immediately as a spoken
    # failure instead of self-healing. Safe to retry here even for POST
    # device/screen commands: a retry reuses the same idempotency_key, so if
    # the first attempt actually reached apps/api and succeeded (and only the
    # response was lost), apps/api replays that result instead of
    # re-actuating the device (see voice-internal.ts's idempotencyStore).
    #
    # Timeout was 8s and this call is normally 127.0.0.1/localhost, should
    # complete in well under 100ms when apps/api is actually up. Turned out
    # the real cost of a down API wasn't this timeout value at all — it was
    # "localhost" resolving to both ::1 and 127.0.0.1 and urllib3 trying both
    # in sequence (see _base_url()), doubling every attempt regardless of
    # what timeout was configured here. With that fixed (base URL now an
    # IPv4 literal by default), this 1.5s actually does bound each attempt:
    # ~1.5s x 2 attempts + the retry delay = ~3.3s worst case when genuinely
    # down, instead of the original ~8.3-8.5s. Raise this if a real
    # (non-local) deployment target needs more slack than loopback does.
    try:
        res = _session.request(method, url, json=json_body, headers=headers, timeout=1.5)
    except _RETRYABLE_EXCEPTIONS:
        time.sleep(_RETRY_DELAY_SEC)
        try:
            res = _session.request(
                method, url, json=json_body, headers=headers, timeout=1.5
            )
        except requests.RequestException as e:
            raise CmsClientError(f"Could not reach the CMS at {url}: {e}") from e
    except requests.RequestException as e:
        raise CmsClientError(f"Could not reach the CMS at {url}: {e}") from e

    try:
        body = res.json()
    except ValueError:
        body = {}

    if not res.ok or not body.get("success"):
        message = (body.get("error") or {}).get(
            "message"
        ) or f"CMS request failed ({res.status_code})."
        raise CmsClientError(message)
    return body.get("data")


def _cached_list(key: str, path: str) -> list[dict]:
    now = time.monotonic()
    cached = _name_cache.get(key)
    if cached and now - cached[0] < _NAME_CACHE_TTL_SEC:
        return cached[1]
    data = _request("GET", path) or []
    _name_cache[key] = (now, data)
    return data


def list_devices() -> list[dict]:
    return _cached_list("devices", "/devices")


def list_screens() -> list[dict]:
    return _cached_list("screens", "/screens")


def list_experiences() -> list[dict]:
    return _cached_list("experiences", "/experiences")


def list_media() -> list[dict]:
    return _cached_list("media", "/media")


def device_command(**kwargs: Any) -> dict:
    body = {k: v for k, v in kwargs.items() if v is not None}
    return _request("POST", "/device-command", body, idempotency_key=str(uuid.uuid4()))


def screen_command(**kwargs: Any) -> dict:
    body = {k: v for k, v in kwargs.items() if v is not None}
    return _request("POST", "/screen-command", body, idempotency_key=str(uuid.uuid4()))
