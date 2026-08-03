"""
coordinator.py — single-camera PEOPLE/OBJECT hand-off.

This machine has exactly one physical camera (RealSense D455), shared
between the PEOPLE (face/presence, venv `.venv`) and OBJECT (mat inventory,
venv `.venv-object`) pipelines — they can never run at once (RealSense only
lets one process hold a given sensor's stream). Unlike supervisor.py (which
spawns a fixed, static list of always-on cameras via VISION_CAMERAS, one
subprocess per camera, all sharing `sys.executable`), this coordinator owns
ONE camera and dynamically switches which pipeline holds it:

  - PEOPLE by default.
  - OBJECT whenever the CMS's "Object Recognition" experience
    (templateKey == "object-recognition") is live on any screen.

Trigger source: the API's WS gateway broadcasts SCREEN_CONTENT_CHANGED to any
client registered via UE_REGISTER with an `events:subscribe`-scoped API key
(apps/api/src/ws/gateway.ts). This module subscribes to that feed and reacts.

Run via `python -m vision.coordinator` from services/ (same cwd requirement
as `python -m vision` — see __main__.py). supervisor.py is untouched and
remains valid for a future machine with more than one physical camera; run
only ONE of supervisor.py or coordinator.py at a time — running both against
the same camera recreates the exact conflict this module exists to avoid.
"""

from __future__ import annotations
import json
import logging
import os
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

import websocket  # websocket-client package
from dotenv import load_dotenv

from .config import load_config

_VISION_DIR = Path(__file__).resolve().parent
_SERVICES_DIR = _VISION_DIR.parent
load_dotenv(_VISION_DIR / ".env")

log = logging.getLogger("vision.coordinator")

OBJECT_RECOGNITION_TEMPLATE_KEY = "object-recognition"

_POLL_SECONDS = 3.0
_BACKOFF_START = 1.0
_BACKOFF_MAX = 60.0
_GRACEFUL_STOP_TIMEOUT = 5.0
_WS_RECONNECT_SECONDS = 5

_WORKER_MODULES = {
    "PEOPLE": "vision.workers.people",
    "OBJECT": "vision.workers.object",
}

# PEOPLE's RealSense dims — hardcoded to config.py's own defaults (not read
# from .env's VISION_RS_WIDTH/HEIGHT/FPS, which are dedicated to the OBJECT/
# cam-mat camera at 1280x800; those must never leak into the PEOPLE worker's
# env, or the face camera would silently run at the mat's resolution).
_PEOPLE_RS_WIDTH = 1280
_PEOPLE_RS_HEIGHT = 720
_PEOPLE_RS_FPS = 30


def _default_python(venv_name: str) -> str:
    return str(_VISION_DIR / venv_name / "Scripts" / "python.exe")


def _ws_url(api_url: str, api_key: str) -> str:
    parts = urllib.parse.urlsplit(api_url)
    scheme = "wss" if parts.scheme == "https" else "ws"
    query = urllib.parse.urlencode({"apiKey": api_key})
    return urllib.parse.urlunsplit((scheme, parts.netloc, "/ws/", query, ""))


def _http_get_json(url: str, timeout: float = 5.0) -> Optional[dict]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise


class Coordinator:
    def __init__(self) -> None:
        cfg = load_config()
        self._api_url = cfg.api_url
        self._rs_width = cfg.realsense_width
        self._rs_height = cfg.realsense_height
        self._rs_fps = cfg.realsense_fps

        self._api_key = os.environ.get("VISION_WS_API_KEY", "")
        if not self._api_key:
            raise SystemExit(
                "[coordinator] VISION_WS_API_KEY is not set. Create an "
                "events:subscribe-scoped API key via the CMS admin UI "
                "(Settings > API Keys) and paste it into services/vision/.env."
            )

        self._camera_id = {
            "PEOPLE": os.environ.get("VISION_COORDINATOR_CAMERA_ID", "cam-entrance"),
            "OBJECT": os.environ.get("VISION_COORDINATOR_OBJECT_CAMERA_ID", "cam-mat"),
        }
        self._backend = os.environ.get("VISION_COORDINATOR_BACKEND", "realsense")
        self._index = os.environ.get("VISION_COORDINATOR_INDEX", "0")

        self._python = {
            "PEOPLE": os.environ.get("VISION_PEOPLE_PYTHON") or _default_python(".venv"),
            "OBJECT": os.environ.get("VISION_OBJECT_PYTHON") or _default_python(".venv-object"),
        }
        for mode, python_exe in self._python.items():
            if not Path(python_exe).exists():
                raise SystemExit(
                    f"[coordinator] {mode} venv python not found at {python_exe} — "
                    "check VISION_PEOPLE_PYTHON/VISION_OBJECT_PYTHON or that the "
                    "venv exists."
                )

        self._lock = threading.Lock()
        self._object_active_screens: set[str] = set()
        self._needs_resync = False
        self._current_mode: Optional[str] = None
        self._proc: Optional[subprocess.Popen] = None
        self._backoff = _BACKOFF_START
        self._stopping = False
        self._ws: Optional[websocket.WebSocketApp] = None
        self._ws_thread: Optional[threading.Thread] = None

    # ─── WS subscription ────────────────────────────────────────────────────

    def start_ws(self) -> None:
        url = _ws_url(self._api_url, self._api_key)

        def on_open(ws):
            log.info("[coordinator] WS connected — registering")
            ws.send(json.dumps({"type": "UE_REGISTER", "apiKey": self._api_key}))
            with self._lock:
                self._needs_resync = True

        def on_message(_ws, message):
            try:
                msg = json.loads(message)
            except json.JSONDecodeError:
                return
            msg_type = msg.get("type")
            if msg_type == "UE_REGISTER_ACK":
                log.info("[coordinator] WS registration acknowledged")
            elif msg_type == "UE_REGISTER_NACK":
                log.error(
                    "[coordinator] WS registration rejected (%s) — check "
                    "VISION_WS_API_KEY has the events:subscribe scope",
                    msg.get("reason"),
                )
            elif msg_type == "SCREEN_CONTENT_CHANGED":
                screen_id = msg.get("screenId")
                template_key = (msg.get("content") or {}).get("templateKey")
                if not screen_id:
                    return
                with self._lock:
                    if template_key == OBJECT_RECOGNITION_TEMPLATE_KEY:
                        self._object_active_screens.add(screen_id)
                    else:
                        self._object_active_screens.discard(screen_id)

        def on_error(_ws, error):
            log.warning("[coordinator] WS error: %s", error)

        def on_close(_ws, status_code, _msg):
            log.warning("[coordinator] WS disconnected (%s) — will reconnect", status_code)

        self._ws = websocket.WebSocketApp(
            url, on_open=on_open, on_message=on_message,
            on_error=on_error, on_close=on_close,
        )
        self._ws_thread = threading.Thread(
            target=self._ws.run_forever,
            kwargs={"reconnect": _WS_RECONNECT_SECONDS},
            name="vision-coordinator-ws",
            daemon=True,
        )
        self._ws_thread.start()

    # ─── REST snapshot (initial state + post-reconnect resync) ─────────────

    def _fetch_snapshot(self) -> None:
        try:
            listing = _http_get_json(f"{self._api_url}/api/screens")
            screens = (listing or {}).get("screens", [])
            active: set[str] = set()
            for screen in screens:
                screen_id = screen.get("screenId")
                if not screen_id:
                    continue
                config = _http_get_json(f"{self._api_url}/api/screens/{screen_id}/config")
                template_key = ((config or {}).get("content") or {}).get("templateKey")
                if template_key == OBJECT_RECOGNITION_TEMPLATE_KEY:
                    active.add(screen_id)
            with self._lock:
                self._object_active_screens = active
            log.info(
                "[coordinator] snapshot resynced — %d screen(s) showing object-recognition",
                len(active),
            )
        except Exception:
            log.warning("[coordinator] snapshot fetch failed — keeping current state", exc_info=True)

    # ─── Worker lifecycle ───────────────────────────────────────────────────

    def _spawn(self, mode: str) -> subprocess.Popen:
        env = {
            **os.environ,
            "VISION_CAMERA_ID": self._camera_id[mode],
            "VISION_CAMERA_BACKEND": self._backend,
            "VISION_CAMERA_INDEX": self._index,
        }
        if mode == "OBJECT":
            env["VISION_RS_WIDTH"] = str(self._rs_width)
            env["VISION_RS_HEIGHT"] = str(self._rs_height)
            env["VISION_RS_FPS"] = str(self._rs_fps)
        else:
            env["VISION_RS_WIDTH"] = str(_PEOPLE_RS_WIDTH)
            env["VISION_RS_HEIGHT"] = str(_PEOPLE_RS_HEIGHT)
            env["VISION_RS_FPS"] = str(_PEOPLE_RS_FPS)

        python_exe = self._python[mode]
        module = _WORKER_MODULES[mode]
        log.info("[coordinator] starting %s worker (%s) via %s", mode, module, python_exe)
        return subprocess.Popen(
            [python_exe, "-m", module], env=env, cwd=str(_SERVICES_DIR),
        )

    def _graceful_stop(self, proc: subprocess.Popen) -> None:
        if proc.poll() is None:
            proc.send_signal(signal.SIGTERM)
        try:
            proc.wait(timeout=_GRACEFUL_STOP_TIMEOUT)
        except subprocess.TimeoutExpired:
            log.warning("[coordinator] worker did not exit in time — killing")
            proc.kill()
            proc.wait(timeout=5)

    def _apply_desired_mode(self) -> None:
        with self._lock:
            active_screens = frozenset(self._object_active_screens)
        desired = "OBJECT" if active_screens else "PEOPLE"

        if desired == self._current_mode:
            return

        log.info(
            "[coordinator] desired_mode changed: %s -> %s (active screens: %s)",
            self._current_mode, desired, set(active_screens),
        )
        if self._proc is not None:
            self._graceful_stop(self._proc)
            self._proc = None
            self._current_mode = None

        self._proc = self._spawn(desired)
        self._current_mode = desired
        self._backoff = _BACKOFF_START

    def _check_crash(self) -> None:
        if self._proc is None or self._current_mode is None:
            return
        if self._proc.poll() is None:
            return  # still running

        mode = self._current_mode
        log.warning(
            "[coordinator] %s worker exited unexpectedly — restarting in %.0fs",
            mode, self._backoff,
        )
        time.sleep(self._backoff)
        if self._stopping:
            return
        self._backoff = min(self._backoff * 2, _BACKOFF_MAX)
        self._proc = self._spawn(mode)

    # ─── Main loop ───────────────────────────────────────────────────────────

    def run(self) -> None:
        self.start_ws()
        self._fetch_snapshot()
        self._apply_desired_mode()

        def _stop(*_args) -> None:
            log.info("[coordinator] shutdown requested…")
            self._stopping = True

        signal.signal(signal.SIGINT, _stop)
        signal.signal(signal.SIGTERM, _stop)

        try:
            while not self._stopping:
                time.sleep(_POLL_SECONDS)
                with self._lock:
                    needs_resync = self._needs_resync
                    self._needs_resync = False
                if needs_resync:
                    self._fetch_snapshot()
                self._check_crash()
                self._apply_desired_mode()
        finally:
            if self._proc is not None:
                self._graceful_stop(self._proc)
            if self._ws is not None:
                self._ws.close()
            log.info("[coordinator] stopped.")


def run() -> None:
    Coordinator().run()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    run()
