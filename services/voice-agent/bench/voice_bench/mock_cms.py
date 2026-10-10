"""A recording stand-in for apps/api's /api/internal/voice routes.

TRAVIS's tools (actions/cms_client.py) talk to it over real HTTP, so timeouts,
retries, status codes and error bodies behave like the real thing. It answers
with the same messages and error codes as services/voice-actions.ts, keeps a
little room state (so "what's the AC set to" has a true answer), logs every
request, and can inject faults. It never touches a real device.

What it does NOT replicate: Casambi/Tuya/Home Assistant latency and failures
(only injected ones), the screen gateway, or the database.
"""

from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from actions.safety import SAFE_SECRET

from . import names

SECRET = SAFE_SECRET  # the one secret Travis sends in safety mode
SEEK_STEP_SECONDS = 10


class _Err(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


class MockCms:
    def __init__(self, port: int = 0, latency_ms: float = 0.0):
        self.latency_ms = latency_ms
        self.fixtures = names.Fixtures.fresh()
        self.calls: list[dict] = []
        self.fault: dict | None = None
        self._lock = threading.Lock()
        self._seq = 0
        mock = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.0"  # one request per connection, so stopping the server really cuts the client off

            def log_message(self, *_a):  # quiet
                pass

            def _send(self, status: int, payload: dict):
                html = payload.get("__html__") if isinstance(payload, dict) else None
                data = html.encode() if html is not None else json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("content-type", "text/html; charset=utf-8" if html is not None else "application/json")
                self.send_header("content-length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _handle(self, method: str):
                length = int(self.headers.get("content-length") or 0)
                raw = self.rfile.read(length) if length else b""
                try:
                    body = json.loads(raw) if raw else None
                except ValueError:
                    body = None
                status, payload, _record = mock._dispatch(method, self.path, body, dict(self.headers))
                try:
                    self._send(status, payload)
                except ConnectionError:  # BrokenPipe, Reset, Aborted
                    pass  # the client gave up (timeout test)

            def do_GET(self):
                self._handle("GET")

            def do_POST(self):
                self._handle("POST")

        class Server(ThreadingHTTPServer):
            daemon_threads = True
            allow_reuse_address = True

        self._Handler, self._Server = Handler, Server
        self._server = Server(("127.0.0.1", port), Handler)
        self.port = self._server.server_address[1]
        self._thread: threading.Thread | None = None

    # ── lifecycle ────────────────────────────────────────────────────────
    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self) -> "MockCms":
        if self._thread is None or not self._thread.is_alive():
            if self._server is None:
                self._server = self._Server(("127.0.0.1", self.port), self._Handler)
            self._thread = threading.Thread(target=self._server.serve_forever, daemon=True, name="mock-cms")
            self._thread.start()
        return self

    def stop(self) -> None:
        """Close the socket so new connections are refused (network-failure test)."""
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()
            self._server = None

    def reset(self, fault: dict | None = None, fixtures: names.Fixtures | None = None) -> None:
        self.fixtures = fixtures or names.Fixtures.fresh()
        self.fault = fault
        with self._lock:
            self.calls = []
        self.start()

    def set_state(self, fn) -> None:
        fn(self.fixtures)

    def snapshot(self) -> int:
        with self._lock:
            return len(self.calls)

    def calls_since(self, mark: int) -> list[dict]:
        with self._lock:
            return list(self.calls[mark:])

    # ── dispatch ─────────────────────────────────────────────────────────
    def _dispatch(self, method: str, path: str, body: Any, headers: dict) -> tuple[int, dict, dict]:
        started = time.time()
        with self._lock:
            self._seq += 1
            seq = self._seq
        # Logged on arrival, with status None until it answers: a request that
        # outlives the client's timeout still counts as an attempt.
        record: dict = {
            "seq": seq, "t": started, "method": method, "path": path.split("?")[0].removeprefix("/api/internal/voice"),
            "body": body, "status": None, "ok": False, "message": "", "schema_valid": True, "flags": [], "resolved": [],
        }
        with self._lock:
            self.calls.append(record)
        lowered = {k.lower(): v for k, v in headers.items()}
        try:
            if lowered.get("x-voice-secret") != SECRET:
                raise _Err("UNAUTHORIZED", "Unauthorized", 401)
            if self.latency_ms and method == "POST":
                time.sleep(self.latency_ms / 1000)
            self._maybe_fault(method)
            data = self._route(method, record)
            record["message"] = (data or {}).get("message", "") if isinstance(data, dict) else ""
            record.update(status=200, ok=True)
            return 200, {"success": True, "data": data}, record
        except _Err as e:
            record.update(status=e.status, ok=False, message=e.message, code=e.code)
            return e.status, {"success": False, "error": {"code": e.code, "message": e.message}}, record

    def _maybe_fault(self, method: str) -> None:
        f = self.fault
        if not f or (f.get("only_post", True) and method != "POST"):
            return
        mode = f["mode"]
        if mode == "timeout":
            time.sleep(f.get("sleep", 3.0))  # longer than cms_client's 1.5s timeout
        elif mode == "http400":
            raise _Err("INVALID_INPUT", "The request was rejected.", 400)
        elif mode == "http401":
            raise _Err("UNAUTHORIZED", "Unauthorized", 401)
        elif mode == "http403":
            raise _Err("FORBIDDEN", "Not authorized.", 403)
        elif mode == "http500":
            raise _Err("INTERNAL", "Something went wrong.", 500)
        elif mode == "device_unavailable":
            raise _Err("DRIVER_ERROR", "The device didn't respond.", 400)

    def _route(self, method: str, record: dict) -> Any:
        path, body = record["path"], record["body"]
        fx = self.fixtures
        if method == "GET":
            if path == "/devices":
                return [{"id": d["id"], "type": d["type"], "name": d["name"], "state": fx.devices[d["id"]]} for d in names.DEVICES]
            if path == "/screens":
                return [
                    {"screenId": s["screenId"], "screenName": s["label"], "blanked": fx.screens[s["screenId"]]["blanked"],
                     "experienceName": fx.screens[s["screenId"]]["experienceName"], "mediaName": fx.screens[s["screenId"]]["mediaName"]}
                    for s in names.SCREENS
                ]
            if path == "/experiences":
                return names.EXPERIENCES
            if path == "/media":
                return names.MEDIA
            raise _Err("NOT_FOUND", "Not found.", 404)
        if path == "/device-command":
            return self._device(body, record)
        if path == "/screen-command":
            return self._screen(body, record)
        raise _Err("NOT_FOUND", "Not found.", 404)

    # ── device-command ───────────────────────────────────────────────────
    _ACTIONS = {
        "lights_on", "lights_off", "lights_set", "scene_recall", "ac_command", "lock", "unlock", "status",
        "good_night", "good_morning", "ambient_mode", "all_lights_on", "all_lights_off",
    }

    def _validate_device(self, b: Any) -> None:
        ok = isinstance(b, dict) and b.get("action") in self._ACTIONS
        if ok:
            t = b.get("target")
            ok = t is None or (isinstance(t, str) and len(t) >= 1)
            br = b.get("brightness")
            ok = ok and (br is None or (_is_num(br) and 0 <= br <= 100))
            ok = ok and (b.get("color") is None or isinstance(b["color"], str))
            ok = ok and (b.get("command") is None or isinstance(b["command"], str))
            ok = ok and (b.get("params") is None or isinstance(b["params"], dict))
        if not ok:
            raise _Err("INVALID_INPUT", "Invalid request.", 400)

    def _device(self, b: Any, record: dict) -> dict:
        try:
            self._validate_device(b)
        except _Err:
            record["schema_valid"] = False
            raise
        action, target = b["action"], b.get("target")
        fx = self.fixtures
        lights = [d for d in names.DEVICES if d["type"] == "light"]

        if action in ("lock", "unlock"):
            fx.door_locked = action == "lock"
            return {"message": f"Door {'locked' if fx.door_locked else 'unlocked'}."}
        if action == "scene_recall":
            raise _Err("UNSUPPORTED", "Scenes aren't available by voice.")
        if action == "good_night":
            for d in lights:
                fx.devices[d["id"]]["on"] = False
            fx.devices["dev-ac"]["power"] = False
            record["resolved"] = [d["id"] for d in lights] + ["dev-ac"]
            return {"message": f"Turned off {len(lights)} lights and the AC."}
        if action == "good_morning":
            for d in lights:
                fx.devices[d["id"]].update(on=True, brightness=fx.devices[d["id"]].get("brightness") or 100)
            fx.devices["dev-ac"]["power"] = True
            record["resolved"] = [d["id"] for d in lights] + ["dev-ac"]
            return {"message": f"Turned on {len(lights)} lights and the AC."}
        if action in ("all_lights_on", "all_lights_off"):
            on = action == "all_lights_on"
            for d in lights:
                fx.devices[d["id"]]["on"] = on
                if on and not fx.devices[d["id"]].get("brightness"):
                    fx.devices[d["id"]]["brightness"] = 100
            record["resolved"] = [d["id"] for d in lights]
            return {"message": f"Turned {'on' if on else 'off'} {len(lights)} lights."}
        if action == "ambient_mode":
            labels = [lbl for _, lbl in names.AMBIENT_MODES]
            if not target:
                raise _Err("NEEDS_TARGET", "Which mode did you mean?" + names.options_hint(labels, "modes"))
            mode = names.resolve_ambient_mode(target)
            if not mode:
                raise _Err(
                    "AMBIGUOUS_TARGET",
                    f'I couldn\'t find a mode matching "{target}". Which one did you mean?' + names.options_hint(labels, "modes"),
                )
            fx.ambient = mode[0]
            record["resolved"] = [d["id"] for d in lights]
            return {"message": f"{mode[1]} mode is on."}

        if action == "ac_command":
            key = self._tv_audio_key(b.get("command"))
            if key:
                return self._tv_audio(key, b, record)
        if not target:
            raise _Err("NEEDS_TARGET", "Which device did you mean?")

        if action in ("status", "lights_on", "lights_off", "lights_set"):
            group = names.resolve_device(target, group=True)
            if not group:
                raise _Err("AMBIGUOUS_TARGET", f'I couldn\'t find exactly one device matching "{target}". Which one did you mean?')
            record["resolved"] = [d["id"] for d in group]
            return self._lights_or_status(action, group, b, record)

        # ac_command on one device
        devices = names.resolve_device(target)
        if not devices:
            raise _Err("AMBIGUOUS_TARGET", f'I couldn\'t find exactly one device matching "{target}". Which one did you mean?')
        dev = devices[0]
        record["resolved"] = [dev["id"]]
        return self._ir(dev, b, record)

    @staticmethod
    def _tv_audio_key(command: str | None) -> str | None:
        c = "".join(ch for ch in (command or "").lower() if ch not in " _-")
        if c in ("volumeup", "volup", "volumeplus", "volume+"):
            return "Volume Up"
        if c in ("volumedown", "voldown", "volumeminus", "volume-"):
            return "Volume Down"
        if c in ("mute", "unmute"):
            return "mute"
        return None

    def _tv_audio(self, key: str, b: dict, record: dict) -> dict:
        record["resolved"] = ["dev-tv"]
        raw = (b.get("params") or {}).get("times", 1)
        if key != "mute" and (not _is_num(raw) or not 1 <= raw <= 10):
            record["flags"].append("times_out_of_range")
        times = 1 if key == "mute" else min(10, max(1, round(float(raw)) if _is_num(raw) else 1))
        if key == "mute":
            return {"message": "Pressed mute on the TV. It's a toggle, so that switched mute on or off — the TV doesn't say which."}
        word = "up" if key == "Volume Up" else "down"
        return {"message": f"Turned the volume {word} {times} step{'' if times == 1 else 's'} on the TV."}

    def _lights_or_status(self, action: str, group: list[dict], b: dict, record: dict) -> dict:
        fx = self.fixtures
        if action == "status":
            first = group[0]
            if first["ir"] in ("tv", "soundbar"):
                return {"message": "The TV's volume can't be read back — its remote only sends volume up, volume down and mute."}
            if first["ir"] == "ac":
                st = fx.devices[first["id"]]
                temp = f" set to {st['temp']}°C" if st.get("temp") else ""
                return {"message": f"{first['name']} is {'on' if st['power'] else 'off'}{temp}."}
            return {"message": " ".join(self._describe(d, fx.devices[d["id"]]) for d in group)}
        if any(d["type"] != "light" for d in group):
            raise _Err("DRIVER_ERROR", f"{group[0]['name']} isn't a light, so I can't do that.")
        on = action != "lights_off"
        color = b.get("color")
        if color and on:
            hexed = isinstance(color, str) and len(color.lstrip("#")) in (3, 6) and all(
                c in "0123456789abcdefABCDEF" for c in color.lstrip("#")
            )
            if not hexed and names.compact(color.replace("light", "")) not in names.LIGHT_COLOR_NAMES:
                record["flags"].append("unknown_color")
                raise _Err(
                    "AMBIGUOUS_TARGET",
                    f'I don\'t have a colour called "{color}". The colours I can do are: {", ".join(names.LIGHT_COLOR_CHOICES)}.',
                )
        prior_on = {d["id"]: fx.devices[d["id"]]["on"] for d in group}
        for d in group:
            st = fx.devices[d["id"]]
            br = b.get("brightness")
            st["on"] = on
            if br is not None:
                st["brightness"] = br
            elif on and not st.get("brightness"):
                st["brightness"] = 100
            if color and on:
                st["color"] = color
        plain = action in ("lights_on", "lights_off")
        none_changed = plain and all(prior_on[d["id"]] == on for d in group)
        if len(group) == 1:
            st = fx.devices[group[0]["id"]]
            return {"message": self._describe(group[0], st, already=none_changed)}
        is_l3 = {d["id"] for d in group} == {"dev-l1", "dev-l2"}
        label = "tusker L3" if is_l3 else " and ".join(d["name"] for d in group)
        verb = ("is already" if none_changed else "is now") if is_l3 else ("are already" if none_changed else "are now")
        return {"message": f"{label} {verb} {'on' if on else 'off'}."}

    @staticmethod
    def _describe(dev: dict, st: dict, already: bool = False) -> str:
        if not st.get("on"):
            return f"{dev['name']} is {'already ' if already else ''}off."
        br = st.get("brightness")
        base = f"{dev['name']} is {'already ' if already else ''}on"
        return f"{base} at {br}%." if isinstance(br, (int, float)) else f"{base}."

    _AC_COMMANDS = {"power_on", "power_off", "set_temp", "set_mode", "set_fan"}
    _TV_KEYS = {"power", "volume up", "volume down", "mute", "channel up", "channel down", "ok", "menu", "up", "down",
                "left", "right", "source", "input", "exit", *map(str, range(10))}

    def _ir(self, dev: dict, b: dict, record: dict) -> dict:
        cmd = b.get("command")
        if not cmd:
            raise _Err("NEEDS_TARGET", "Which command did you mean?")
        params = b.get("params") or {}
        st = self.fixtures.devices[dev["id"]]
        if dev["ir"] == "ac":
            if cmd not in self._AC_COMMANDS:
                raise _Err("DRIVER_ERROR", f'"{cmd}" isn\'t a command I know for {dev["name"]}.')
            if cmd == "power_on":
                st["power"] = True
            elif cmd == "power_off":
                st["power"] = False
            elif cmd == "set_temp":
                t = params.get("temp")
                if not _is_num(t):
                    raise _Err("DRIVER_ERROR", f'"{cmd}" needs a temperature for {dev["name"]}.')
                if not names.AC_MIN_TEMP <= t <= names.AC_MAX_TEMP:
                    record["flags"].append("temp_out_of_range")
                st["temp"], st["power"] = t, True
            elif cmd == "set_mode":
                m = params.get("mode")
                if m not in names.AC_MODES:
                    record["flags"].append("unknown_mode")
                    raise _Err("DRIVER_ERROR", f'"{m}" isn\'t a mode {dev["name"]} has.')
                st["mode"] = m
            elif cmd == "set_fan":
                f = params.get("fan")
                if f not in names.AC_FANS:
                    record["flags"].append("unknown_fan")
                    raise _Err("DRIVER_ERROR", f'"{f}" isn\'t a fan speed {dev["name"]} has.')
                st["fan"] = f
            return {"message": f'Sent "{cmd}" to {dev["name"]}.'}
        if dev["ir"] in ("tv", "soundbar"):
            if str(cmd).lower() not in self._TV_KEYS:
                raise _Err("DRIVER_ERROR", f'"{cmd}" isn\'t a button I know for {dev["name"]}.')
            if str(cmd).lower() == "power":
                st["power"] = not st.get("power", True)
            return {"message": f'Sent "{cmd}" to {dev["name"]}.'}
        raise _Err("DRIVER_ERROR", f"{dev['name']} doesn't take remote commands.")

    # ── screen-command ───────────────────────────────────────────────────
    _SCREEN_ACTIONS = {
        "assign_experience", "assign_media", "idle", "stop", "status", "play", "pause", "seek_forward",
        "seek_back", "next_item", "previous_item", "reset_view",
    }

    def _screen(self, b: Any, record: dict) -> dict:
        ok = isinstance(b, dict) and b.get("action") in self._SCREEN_ACTIONS and isinstance(b.get("screen"), str) and b["screen"]
        ok = ok and (b.get("content") is None or isinstance(b["content"], str))
        if not ok:
            record["schema_valid"] = False
            raise _Err("INVALID_INPUT", "Invalid request.", 400)
        action = b["action"]
        screen = names.resolve_screen(b["screen"])
        if screen is None:
            raise _Err(
                "AMBIGUOUS_TARGET",
                f'I couldn\'t find exactly one screen matching "{b["screen"]}". Which one did you mean?'
                + names.options_hint([s["label"] for s in names.SCREENS], "screens"),
            )
        record["resolved"] = [screen["screenId"]]
        st, label = self.fixtures.screens[screen["screenId"]], screen["label"]
        if action == "assign_experience":
            if not b.get("content"):
                raise _Err("NEEDS_TARGET", "Which experience did you mean?")
            exp = names.resolve_experience(b["content"])
            if exp is None:
                raise _Err(
                    "AMBIGUOUS_TARGET",
                    f'I couldn\'t find exactly one experience matching "{b["content"]}". Which one did you mean?'
                    + names.options_hint([e["title"] for e in names.EXPERIENCES], "experiences"),
                )
            st.update(experienceName=exp["title"], mediaName=None, blanked=False)
            return {"message": f'Pushed "{exp["title"]}" to {label}.'}
        if action == "assign_media":
            if not b.get("content"):
                raise _Err("NEEDS_TARGET", "Which media item did you mean?")
            media = names.resolve_media(b["content"])
            if media is None:
                raise _Err(
                    "AMBIGUOUS_TARGET",
                    f'I couldn\'t find exactly one media item matching "{b["content"]}". Which one did you mean?'
                    + names.options_hint([m["name"] for m in names.MEDIA], "media items"),
                )
            st.update(mediaName=media["name"], experienceName=None, blanked=False)
            return {"message": f'Pushed "{media["name"]}" to {label}.'}
        if action == "idle":
            st.update(experienceName=None, mediaName=None, blanked=False)
            return {"message": f"{label} is now idle."}
        if action == "stop":
            st["blanked"] = True
            return {"message": f"{label} is stopped (black screen)."}
        if action == "status":
            showing = st["experienceName"] or st["mediaName"] or "nothing"
            return {"message": f"{label} is {'blanked' if st['blanked'] else 'showing ' + showing}."}
        if action in ("play", "pause"):
            return {"message": f"{label} {'paused' if action == 'pause' else 'playing'}."}
        if action in ("seek_forward", "seek_back"):
            return {"message": f"{label} skipped {'forward' if action == 'seek_forward' else 'back'} {SEEK_STEP_SECONDS} seconds."}
        if action == "reset_view":
            return {"message": f"{label} reset to the start."}
        raise _Err("UNSUPPORTED", f"{label} doesn't have a playlist queued right now.")
