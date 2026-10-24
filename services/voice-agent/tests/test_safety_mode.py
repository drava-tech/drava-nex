"""Safety mode (actions/safety.py + cms_client) and the room simulator (bench/room_sim). Nothing here leaves the loopback interface:
every refusal test replaces the HTTP session with a fake that fails the test if it is ever called."""

import http.client
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import requests

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from actions import cms_client, safety  # noqa: E402
from bench.room_sim.sim import RoomSim  # noqa: E402


class _NoNetwork:
    """Stands in for the HTTP session: any request is a test failure (and records what it was)."""

    def __init__(self):
        self.calls = []

    def request(self, *a, **kw):
        self.calls.append((a, kw))
        raise AssertionError(f"a request was sent: {a} {kw.get('headers')}")


class _Capture:
    """A session that records headers and url, then answers like a CMS."""

    def __init__(self):
        self.calls = []

    def request(self, method, url, **kw):
        self.calls.append((method, url, kw))
        r = mock.Mock(status_code=200, ok=True)
        r.json.return_value = {"success": True, "data": []}
        return r


def _cfg(url, **extra):
    return {"cms_api_base_url": url, "cms_voice_secret": "REAL-SECRET-DO-NOT-SEND", **extra}


class _Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        p = mock.patch.object(safety, "LOG_PATH", Path(self.tmp.name) / "safety.jsonl")
        p.start()
        self.addCleanup(p.stop)
        e = mock.patch.dict(os.environ, {}, clear=False)
        e.start()
        self.addCleanup(e.stop)
        os.environ.pop(safety.ENV_ALLOW_REAL, None)
        cms_client._name_cache.clear()

    def call_with(self, cfg, session):
        with mock.patch.object(cms_client, "_load_config", lambda: cfg), mock.patch.object(cms_client, "_session", session):
            return cms_client.device_command(action="lights_on", target="x")

    def logged(self):
        p = Path(self.tmp.name) / "safety.jsonl"
        return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines()] if p.exists() else []


class RefusalTests(_Base):
    def refused(self, url, why=None, resolves=None):
        sess = _NoNetwork()
        patches = [mock.patch.object(safety.socket, "getaddrinfo", lambda host, port, **kw: [(2, 1, 6, "", (ip, port)) for ip in resolves])] if resolves else []
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        with self.assertRaises(cms_client.CmsClientError) as cm:
            self.call_with(_cfg(url), sess)
        self.assertIn("Safety mode blocked", str(cm.exception))
        if why:
            self.assertIn(why, str(cm.exception))
        self.assertEqual(sess.calls, [], "nothing may be sent")
        self.assertTrue(self.logged(), "the refusal is logged")

    def test_the_real_api_on_loopback_port_4000_is_refused(self):
        self.refused("http://127.0.0.1:4000", "port 4000")

    def test_localhost_port_4000_is_refused(self):
        self.refused("http://localhost:4000", "port 4000")

    def test_a_hostname_that_resolves_to_loopback_on_a_disallowed_port_is_refused(self):
        self.refused("http://mock.test:4000", "port 4000", resolves=["127.0.0.1"])

    def test_ipv6_loopback_on_4000_is_refused(self):
        self.refused("http://[::1]:4000", "port 4000")

    def test_no_port_means_80_which_is_refused(self):
        self.refused("http://127.0.0.1", "port 80")

    def test_the_real_server_is_refused_even_on_the_allowed_port(self):
        self.refused("http://192.168.1.250:4010", "not a loopback")

    def test_a_hostname_resolving_to_a_lan_address_is_refused(self):
        self.refused("http://cms.local:4010", "not a loopback", resolves=["192.168.1.250"])

    def test_one_non_loopback_answer_among_loopback_ones_is_refused(self):
        self.refused("http://mixed.test:4010", "not a loopback", resolves=["127.0.0.1", "10.0.0.5"])

    def test_https_and_embedded_credentials_are_refused(self):
        self.refused("https://127.0.0.1:4010", "plain http")
        self.refused("http://user:pw@127.0.0.1:4010", "user name")

    def test_an_unresolvable_name_is_refused(self):
        sess = _NoNetwork()
        with mock.patch.object(safety.socket, "getaddrinfo", side_effect=OSError("no such host")):
            with self.assertRaises(cms_client.CmsClientError):
                self.call_with(_cfg("http://nowhere.test:4010"), sess)
        self.assertEqual(sess.calls, [])

    def test_the_log_never_holds_credentials(self):
        self.refused("http://user:topsecret@192.168.1.250:4010")
        self.assertNotIn("topsecret", json.dumps(self.logged()))

    def test_environment_override_of_the_address_is_vetted_too(self):
        # whatever address ends up in the config is what is checked, however it got there
        self.refused("http://10.1.2.3:4010", "not a loopback")


class AllowedTests(_Base):
    def test_the_mock_port_on_loopback_is_allowed_and_sends_the_mock_secret_not_the_real_one(self):
        sess = _Capture()
        self.call_with(_cfg("http://127.0.0.1:4010"), sess)
        method, url, kw = sess.calls[0]
        self.assertEqual(url, "http://127.0.0.1:4010/api/internal/voice/device-command")
        self.assertEqual(kw["headers"]["x-voice-secret"], safety.SAFE_SECRET)
        self.assertNotIn("REAL-SECRET", json.dumps(kw["headers"]))
        self.assertFalse(kw["allow_redirects"])

    def test_a_loopback_hostname_connects_to_the_resolved_ip_not_the_name(self):
        sess = _Capture()
        with mock.patch.object(safety.socket, "getaddrinfo", lambda host, port, **kw: [(2, 1, 6, "", ("127.0.0.1", port))]):
            self.call_with(_cfg("http://mock.test:4010"), sess)
        _m, url, kw = sess.calls[0]
        self.assertTrue(url.startswith("http://127.0.0.1:4010/"))
        self.assertEqual(kw["headers"]["Host"], "mock.test:4010")

    def test_the_session_ignores_proxy_environment_variables(self):
        self.assertFalse(cms_client._session.trust_env)


class SwitchTests(_Base):
    def test_default_is_on(self):
        self.assertTrue(safety.enabled({}))
        self.assertTrue(safety.enabled({"safety_mode": True}))

    def test_config_false_switches_it_off(self):
        self.assertFalse(safety.enabled({"safety_mode": False}))

    def test_the_environment_alone_does_not_switch_it_off(self):
        os.environ[safety.ENV_ALLOW_REAL] = "1"
        self.assertTrue(safety.enabled({}))

    def test_only_a_literal_false_switches_it_off(self):
        for v in (None, 0, "false", "off", ""):
            self.assertTrue(safety.enabled({"safety_mode": v}), v)

    def test_off_in_config_then_real_addresses_pass(self):
        cfg = _cfg("http://192.168.1.250", safety_mode=False)
        sess = _Capture()
        self.call_with(cfg, sess)  # fake session: still nothing leaves this machine
        self.assertEqual(sess.calls[0][2]["headers"]["x-voice-secret"], "REAL-SECRET-DO-NOT-SEND")
        self.assertEqual(sess.calls[0][1], "http://192.168.1.250/api/internal/voice/device-command")

    def test_the_allowed_ports_are_a_constant_no_config_key_widens(self):
        self.assertEqual(safety.ALLOWED_PORTS, frozenset({4010}))
        sess = _NoNetwork()
        with self.assertRaises(cms_client.CmsClientError):
            self.call_with(_cfg("http://127.0.0.1:4000", safety_allowed_ports=[4000], allowed_ports=[4000]), sess)


class _Redirector(BaseHTTPRequestHandler):
    seen = []

    def do_POST(self):
        self.rfile.read(int(self.headers.get("content-length") or 0))  # unread request data makes Windows reset the connection, which the client retries
        _Redirector.seen.append(self.path)
        self.send_response(302)
        self.send_header("Location", "http://127.0.0.1:9/elsewhere")
        self.send_header("content-length", "0")
        self.end_headers()

    do_GET = do_POST

    def log_message(self, *_a):
        pass


class RedirectTests(_Base):
    def test_a_redirect_is_not_followed(self):
        _Redirector.seen = []
        srv = ThreadingHTTPServer(("127.0.0.1", 0), _Redirector)
        self.addCleanup(srv.server_close)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.shutdown)
        port = srv.server_address[1]
        fresh = requests.Session()  # not the shared one: a stale pooled connection to a reused port would trigger the retry and a second request
        fresh.trust_env = False
        self.addCleanup(fresh.close)
        with mock.patch.object(safety, "ALLOWED_PORTS", frozenset({port})), mock.patch.object(cms_client, "_load_config", lambda: _cfg(f"http://127.0.0.1:{port}")), \
                mock.patch.object(cms_client, "_session", fresh):
            with self.assertRaises(cms_client.CmsClientError) as cm:
                cms_client.device_command(action="lights_on", target="x")
        self.assertIn("redirect", str(cm.exception))
        self.assertEqual(len(_Redirector.seen), 1, "only the original request was made; the Location was not followed")


def _http(port, method, path, body=None, headers=None):
    c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    h = dict(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body)
        h["content-type"] = "application/json"
    c.request(method, path, body=data, headers=h)
    r = c.getresponse()
    raw = r.read().decode()
    c.close()
    return r.status, raw


class SimTests(_Base):
    @classmethod
    def setUpClass(cls):
        cls.sim = RoomSim(port=0).start()
        cls.port = cls.sim.port

    @classmethod
    def tearDownClass(cls):
        cls.sim.stop()

    def setUp(self):
        super().setUp()
        self.sim.reset_all()
        p = mock.patch.object(safety, "ALLOWED_PORTS", frozenset({self.port}))
        p.start()
        self.addCleanup(p.stop)
        c = mock.patch.object(cms_client, "_load_config", lambda: _cfg(f"http://127.0.0.1:{self.port}"))
        c.start()
        self.addCleanup(c.stop)

    def dev(self, **kw):
        return cms_client.device_command(**kw)

    def state(self, dev_id):
        return self.sim.fixtures.devices[dev_id]

    # binding and dashboard protection
    def test_it_listens_on_loopback_only(self):
        self.assertEqual(self.sim._server.server_address[0], "127.0.0.1")

    def test_the_dashboard_page_and_state_are_served_to_the_loopback_host(self):
        st, page = _http(self.port, "GET", "/")
        self.assertEqual(st, 200)
        self.assertIn("Room simulator", page)
        st, raw = _http(self.port, "GET", "/__sim/state")
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(raw)["data"]["listening_on"], f"127.0.0.1:{self.port}")

    def test_a_foreign_host_header_is_refused(self):
        for path in ("/", "/__sim/state"):
            st, _ = _http(self.port, "GET", path, headers={"Host": "evil.example"})
            self.assertEqual(st, 403, path)

    def test_state_changes_need_the_x_sim_header(self):
        self.dev(action="lights_on", target="tusker edge")
        st, _ = _http(self.port, "POST", "/__sim/reset", {})
        self.assertEqual(st, 403)
        self.assertTrue(self.state("dev-edge")["on"])
        st, _ = _http(self.port, "POST", "/__sim/reset", {}, headers={"X-Sim": "1"})
        self.assertEqual(st, 200)
        self.assertFalse(self.state("dev-edge")["on"])

    def test_reset_clears_state_log_and_failures(self):
        self.dev(action="lock")
        self.dev(action="unlock")
        self.sim.set_fault("dev-ac", "offline")
        self.sim.reset_all()
        self.assertTrue(self.sim.fixtures.door_locked)
        self.assertEqual((self.sim.faults, self.sim.calls, self.sim.volume_steps), ({}, [], 0))

    # device behaviour and limits
    def test_light_on_off_and_brightness(self):
        self.dev(action="lights_on", target="tusker edge")
        self.dev(action="lights_set", target="tusker edge", brightness=40)
        self.assertEqual((self.state("dev-edge")["on"], self.state("dev-edge")["brightness"]), (True, 40))
        with self.assertRaises(cms_client.CmsClientError):
            self.dev(action="lights_set", target="tusker edge", brightness=140)
        self.assertEqual(self.state("dev-edge")["brightness"], 40)

    def test_ac_temperature_range_is_enforced(self):
        self.dev(action="ac_command", target="AC", command="set_temp", params={"temp": 22})
        self.assertEqual(self.state("dev-ac")["temp"], 22)
        for bad in (99, 10):
            with self.assertRaises(cms_client.CmsClientError) as cm:
                self.dev(action="ac_command", target="AC", command="set_temp", params={"temp": bad})
            self.assertIn("16 to 30", str(cm.exception))
        self.assertEqual(self.state("dev-ac")["temp"], 22)

    def test_ac_setpoint_is_only_kept_in_cool_and_heat(self):
        self.dev(action="ac_command", target="AC", command="set_mode", params={"mode": "fan"})
        self.dev(action="ac_command", target="AC", command="set_temp", params={"temp": 18})
        self.assertEqual(self.state("dev-ac")["temp"], 24)
        with self.assertRaises(cms_client.CmsClientError):
            self.dev(action="ac_command", target="AC", command="set_mode", params={"mode": "turbo"})

    def test_door_lock_state(self):
        self.dev(action="unlock")
        self.assertFalse(self.sim.fixtures.door_locked)
        self.dev(action="lock")
        self.assertTrue(self.sim.fixtures.door_locked)

    def test_volume_is_remote_presses_with_no_level(self):
        self.dev(action="ac_command", target="soundbar", command="Volume Up", params={"times": 3})
        self.dev(action="ac_command", target="TV", command="Volume Down")
        self.assertEqual(self.sim.volume_steps, 2)
        self.dev(action="ac_command", target="TV", command="Volume Up", params={"times": 50})
        self.assertEqual(self.sim.volume_steps, 12)  # 50 presses are clamped to 10
        self.dev(action="ac_command", target="TV", command="mute")
        self.assertTrue(self.sim.muted)
        self.assertNotIn("%", self.sim.calls[-1]["message"])

    def test_unknown_device_and_command_are_rejected(self):
        with self.assertRaises(cms_client.CmsClientError):
            self.dev(action="lights_on", target="the garden gnome")
        with self.assertRaises(cms_client.CmsClientError):
            self.dev(action="ac_command", target="TV", command="self-destruct")

    def test_screens_show_stop_and_reject_unknown_content(self):
        cms_client.screen_command(action="assign_media", screen="tusker 86", content="Welcome Video")
        self.assertEqual(self.sim.fixtures.screens["main-screen"]["mediaName"], "Welcome Video")
        cms_client.screen_command(action="stop", screen="tusker 86")
        self.assertTrue(self.sim.fixtures.screens["main-screen"]["blanked"])
        with self.assertRaises(cms_client.CmsClientError):
            cms_client.screen_command(action="assign_media", screen="tusker 86", content="Nonexistent Film")

    # failures
    def test_an_offline_device_fails_and_changes_nothing(self):
        self.sim.set_fault("dev-ac", "offline")
        with self.assertRaises(cms_client.CmsClientError) as cm:
            self.dev(action="ac_command", target="AC", command="power_on")
        self.assertIn("didn't respond", str(cm.exception))
        self.assertFalse(self.state("dev-ac")["power"])

    def test_one_device_failing_does_not_break_the_others(self):
        self.sim.set_fault("dev-edge", "offline")
        self.dev(action="lights_on", target="tusker L1")
        self.assertTrue(self.state("dev-l1")["on"])
        with self.assertRaises(cms_client.CmsClientError):
            self.dev(action="lights_on", target="tusker edge")

    def test_an_error_reply_carries_its_text_and_the_door_can_fail(self):
        self.sim.set_fault("door", "error", message="Home Assistant returned 503")
        with self.assertRaises(cms_client.CmsClientError) as cm:
            self.dev(action="lock")
        self.assertIn("Home Assistant returned 503", str(cm.exception))

    def test_an_offline_screen_says_it_is_not_connected(self):
        self.sim.set_fault("kiosk", "offline")
        with self.assertRaises(cms_client.CmsClientError) as cm:
            cms_client.screen_command(action="stop", screen="tusker 27")
        self.assertIn("isn't connected", str(cm.exception))

    def test_a_slow_device_that_outlasts_the_timeout_is_commanded_once_and_the_retry_gets_the_same_answer(self):
        self.sim.set_fault("dev-edge", "slow", delay=3.4)
        t0 = time.monotonic()
        out = self.dev(action="lights_on", target="tusker edge")
        self.assertGreater(time.monotonic() - t0, 3.0)
        self.assertIn("on", out["message"])
        posts = [c for c in self.sim.calls if c["method"] == "POST"]
        self.assertEqual(len(posts), 2)
        self.assertIn("replayed", posts[1]["flags"])
        self.assertTrue(self.state("dev-edge")["on"])

    def test_clearing_a_failure_restores_the_device(self):
        self.sim.set_fault("dev-ac", "offline")
        self.sim.set_fault("dev-ac", None)
        self.dev(action="ac_command", target="AC", command="power_on")
        self.assertTrue(self.state("dev-ac")["power"])

    def test_failures_can_be_set_through_the_dashboard_api(self):
        st, _ = _http(self.port, "POST", "/__sim/fault", {"key": "dev-ac", "mode": "offline"}, headers={"X-Sim": "1"})
        self.assertEqual(st, 200)
        self.assertEqual(self.sim.faults["dev-ac"]["mode"], "offline")
        st, _ = _http(self.port, "POST", "/__sim/fault", {"key": "no-such-device", "mode": "offline"}, headers={"X-Sim": "1"})
        self.assertEqual(st, 400)


if __name__ == "__main__":
    unittest.main()
