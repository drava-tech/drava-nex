"""
supervisor.py — manages one worker subprocess per configured camera.

VISION_CAMERAS is a JSON array of camera configs, e.g.:
  [{"id": "cam-entrance", "mode": "PEOPLE", "backend": "opencv", "index": 0},
   {"id": "cam-mat", "mode": "OBJECT", "backend": "realsense", "width": 1280, "height": 800}]

PEOPLE (face detection) and OBJECT (product detection) are both implemented;
any other mode is skipped with a warning. Each camera runs in its own
subprocess so the two GPU runtimes (onnxruntime-gpu for faces, torch for
YOLO) never load in the same process — see requirements.txt vs
requirements-object.txt.

Optional per-camera `width`/`height`/`fps` override the RealSense stream
resolution for just that subprocess (e.g. the mat camera wants 1280x800 for
tiled inference, distinct from the face default of 1280x720).

ponytail: a 3s poll loop restarts crashed workers with exponential backoff.
Upgrade path: long-poll GET /api/vision/cameras for CMS-driven live
reconfiguration (add/remove/retask cameras without restarting the supervisor).
"""

from __future__ import annotations
import json
import logging
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

# The supervisor reads VISION_CAMERAS (and passes the rest through to workers)
# from the environment — load services/vision/.env here too, same as config.py,
# so `python -m vision` works without the vars being exported in the shell.
load_dotenv(Path(__file__).with_name(".env"))

log = logging.getLogger("vision.supervisor")

_POLL_SECONDS = 3.0
_BACKOFF_START = 1.0
_BACKOFF_MAX = 60.0


_WORKER_MODULES = {
    "PEOPLE": "vision.workers.people",
    "OBJECT": "vision.workers.object",
}


def _spawn(cam: dict) -> subprocess.Popen:
    """Start the right worker subprocess (by mode) for one camera."""
    mode = str(cam.get("mode", "PEOPLE")).upper()
    env = {
        **os.environ,
        "VISION_CAMERA_ID": str(cam["id"]),
        "VISION_CAMERA_BACKEND": str(cam.get("backend", "opencv")),
        "VISION_CAMERA_INDEX": str(cam.get("index", 0)),
    }
    # Per-camera resolution override (e.g. the mat camera wants 1280x800 for
    # tiled inference) — only injected into this subprocess's env, so it never
    # affects other cameras sharing the same supervisor.
    if "width" in cam:
        env["VISION_RS_WIDTH"] = str(cam["width"])
    if "height" in cam:
        env["VISION_RS_HEIGHT"] = str(cam["height"])
    if "fps" in cam:
        env["VISION_RS_FPS"] = str(cam["fps"])

    module = _WORKER_MODULES[mode]
    log.info("[supervisor] starting %s worker (%s) for camera %s", mode, module, cam["id"])
    return subprocess.Popen([sys.executable, "-m", module], env=env)


def run() -> None:
    raw = os.environ.get("VISION_CAMERAS", "[]")
    try:
        cameras = json.loads(raw)
        assert isinstance(cameras, list)
    except (json.JSONDecodeError, AssertionError):
        raise SystemExit(f"[supervisor] VISION_CAMERAS must be a JSON array, got: {raw!r}")

    # PEOPLE and OBJECT cameras run; warn once for anything else.
    managed: list[dict] = []
    for cam in cameras:
        mode = str(cam.get("mode", "PEOPLE")).upper()
        if mode in _WORKER_MODULES:
            managed.append(cam)
        else:
            log.warning(
                "[supervisor] mode %s not implemented — camera %s will not run",
                mode, cam.get("id"),
            )
    if not managed:
        log.warning("[supervisor] no PEOPLE/OBJECT cameras configured — nothing to run.")

    procs: dict[str, subprocess.Popen] = {}
    backoff: dict[str, float] = {}
    for cam in managed:
        procs[str(cam["id"])] = _spawn(cam)

    stopping = {"flag": False}

    def _stop(*_args) -> None:
        log.info("[supervisor] shutdown requested — terminating workers…")
        stopping["flag"] = True

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    try:
        while not stopping["flag"]:
            time.sleep(_POLL_SECONDS)
            for cam in managed:
                cid = str(cam["id"])
                p = procs.get(cid)
                if p is not None and p.poll() is None:
                    continue  # still running
                delay = backoff.get(cid, _BACKOFF_START)
                log.warning("[supervisor] worker %s exited — restarting in %.0fs", cid, delay)
                time.sleep(delay)
                if stopping["flag"]:
                    break
                backoff[cid] = min(delay * 2, _BACKOFF_MAX)
                procs[cid] = _spawn(cam)
    finally:
        for p in procs.values():
            if p.poll() is None:
                p.send_signal(signal.SIGTERM)
        for p in procs.values():
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
        log.info("[supervisor] stopped.")
