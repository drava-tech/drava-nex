"""Safety mode: Travis may only talk to a localhost mock, never to a real CMS, API or device.

On by default. Every device, screen and inventory request goes through `vet()` (called from actions/cms_client.py) before a socket is
opened. In safety mode a request is allowed only when ALL of this holds:

    * plain http, no user:password in the URL
    * the port is in ALLOWED_PORTS (4010, the room_sim / mock CMS). Loopback alone is NOT enough: 127.0.0.1:4000 is the real
      apps/api, which drives the real lights, door and AC
    * the host is a loopback address, or a name whose every DNS answer is loopback (the request then goes to that IP literal, so DNS
      cannot change its mind between the check and the connection)

Anything else is refused before any connection, written to logs/safety.jsonl and printed as an error. The mock's fixed secret is used
instead of cms_voice_secret, so the real secret is never sent anywhere while safety mode is on.

The one switch is "safety_mode" in config/api_keys.json: true = mock only, false = real CMS (a loud banner prints at startup).
ALLOWED_PORTS is a constant on purpose: no config key can widen it (tests patch it).
"""

from __future__ import annotations

import ipaddress
import json
import socket
import time
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

LOG_PATH = Path(__file__).resolve().parents[1] / "logs" / "safety.jsonl"
ALLOWED_PORTS = frozenset({4010})
SAFE_SECRET = "bench-secret"  # what the mock CMS accepts; the real cms_voice_secret is never used in safety mode
ENV_ALLOW_REAL = "TRAVIS_ALLOW_REAL_DEVICES"  # no longer needed; kept so old scripts/tests that set it don't break

_announced_off = False


class SafetyBlocked(Exception):
    """A request safety mode refused. Nothing was sent."""


def enabled(cfg: dict) -> bool:
    """Safety mode is on unless the config says exactly `"safety_mode": false` (anything else, or a missing key, keeps it on)."""
    global _announced_off
    if cfg.get("safety_mode") is False:
        if not _announced_off:
            _announced_off = True
            print("\n" + "!" * 78 + "\n!! SAFETY MODE IS OFF: Travis can reach the REAL CMS and real devices.\n" + "!" * 78 + "\n", flush=True)
        return False
    return True


def _record(url: str, reason: str) -> None:
    host = urlsplit(url).netloc.rpartition("@")[2]  # never log credentials
    print(f"[safety] BLOCKED request to {host}: {reason}", flush=True)
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps({"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "target": host, "reason": reason}) + "\n")
    except OSError:
        pass  # the console line above is still there


def _block(url: str, reason: str) -> SafetyBlocked:
    _record(url, reason)
    return SafetyBlocked(reason)


def vet(url: str) -> tuple[str, str]:
    """(url to request, Host header) if safety mode allows `url`; raises SafetyBlocked otherwise."""
    try:
        parts = urlsplit(url)
        host, port = parts.hostname, parts.port
    except ValueError as e:
        raise _block(url, f"unreadable address ({e})") from e
    if parts.scheme != "http":
        raise _block(url, f"only plain http to the local mock is allowed, not {parts.scheme or 'no scheme'}")
    if parts.username or parts.password:
        raise _block(url, "a user name or password in the address is not allowed")
    if not host:
        raise _block(url, "no host in the address")
    port = port or 80
    if port not in ALLOWED_PORTS:
        raise _block(url, f"port {port} is not an allowed mock port (allowed: {sorted(ALLOWED_PORTS)}); 127.0.0.1:4000 is the real API")
    try:
        answers = [ipaddress.ip_address(host)]
    except ValueError:
        try:
            infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except OSError as e:
            raise _block(url, f"could not resolve {host} ({e})") from e
        answers = [ipaddress.ip_address(i[4][0]) for i in infos]
    if not answers or not all(a.is_loopback for a in answers):
        raise _block(url, f"{host} is not a loopback address (resolves to {', '.join(map(str, answers))})")
    ipv4 = [a for a in answers if a.version == 4]
    ip = ipv4[0] if ipv4 else answers[0]
    netloc = f"[{ip}]:{port}" if ip.version == 6 else f"{ip}:{port}"
    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, "")), f"{host}:{port}"
