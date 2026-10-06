"""The benchmark's own machinery: WER, canonical actions, the mock CMS, the judge, the report.
(The benchmark itself is run with `python -m bench.voice_bench`; this checks it can be trusted.)"""

import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

import requests  # noqa: E402

from bench.voice_bench import canon, judge, metrics, names, report  # noqa: E402
from bench.voice_bench.canon import AC, DOOR, L, VOL  # noqa: E402
from bench.voice_bench.cases import Case, all_cases, flatten  # noqa: E402
from bench.voice_bench.mock_cms import SECRET, MockCms  # noqa: E402


class MetricsTests(unittest.TestCase):
    def test_wer_counts_each_error_kind(self):
        w, s, d, i, n = metrics.wer("set the ac to 24", "set the ac to 42")
        self.assertEqual((s, d, i, n), (1, 0, 0, 5))
        self.assertAlmostEqual(w, 0.2)
        # a dropped word and an inserted word are counted separately
        _, s, d, i, n = metrics.wer("turn on the lights", "turn the lights")
        self.assertEqual((s, d, i, n), (0, 1, 0, 4))
        _, s, d, i, n = metrics.wer("lights on", "the lights on")
        self.assertEqual((s, d, i, n), (0, 0, 1, 2))

    def test_number_words_equal_digits(self):
        self.assertEqual(metrics.wer("set it to twenty four degrees", "set it to 24 degrees")[0], 0.0)
        self.assertEqual(metrics.wer("one hundred percent", "100 percent")[0], 0.0)

    def test_a_changed_number_is_a_critical_error(self):
        self.assertTrue(metrics.critical_errors("set the ac to 24", "set the ac to 42")["number_changed"])
        self.assertFalse(metrics.critical_errors("set the ac to 24", "set the AC to twenty four")["number_changed"])
        self.assertIn("tusker", metrics.critical_errors("turn on tusker edge", "turn on the edge")["device_word_lost"])

    def test_l_digit_is_one_device_word(self):
        self.assertEqual(metrics.critical_errors("turn on tusker L1", "turn on tusker L 1")["device_word_lost"], [])

    def test_percentiles_and_rate_bound(self):
        v = list(range(1, 101))
        self.assertAlmostEqual(metrics.percentile(v, 50), 50.5)
        self.assertEqual(metrics.latency_summary(v)["p95"], 95)
        self.assertAlmostEqual(metrics.poisson_upper_95(0, 1.0), 3.0)  # rule of three
        self.assertGreater(metrics.poisson_upper_95(5, 1.0), 5)


class CanonTests(unittest.TestCase):
    def call(self, body, path="/device-command", status=200):
        return {"method": "POST", "path": path, "body": body, "status": status}

    def test_ac_aliases_collapse(self):
        for target in ("ac", "the AC", "tusker ac", "air conditioner"):
            acts = canon.canon_call(self.call({"action": "ac_command", "target": target, "command": "set_temp", "params": {"temp": 24}}))
            self.assertEqual(acts, [AC("temp", 24)], target)

    def test_volume_ignores_the_target_like_the_server_does(self):
        acts = canon.canon_call(self.call({"action": "ac_command", "target": "soundbar", "command": "Volume Up", "params": {"times": 3}}))
        self.assertEqual(acts, [VOL("vol_up", 3)])

    def test_lights_set_carries_brightness_and_colour_separately(self):
        acts = canon.canon_call(self.call({"action": "lights_set", "target": "tusker edge", "brightness": 40, "color": "blue"}))
        self.assertEqual([a["op"] for a in acts], ["brightness", "color"])

    def test_l3_is_both_fabric_lights(self):
        acts = canon.canon_call(self.call({"action": "lights_on", "target": "tusker L3"}))
        self.assertEqual(acts, [L("on", "tusker L3")])

    def test_unknown_target_is_marked_unresolved(self):
        acts = canon.canon_call(self.call({"action": "lights_on", "target": "tusker L9"}))
        self.assertTrue(acts[0]["target"].startswith("unresolved:"))

    def test_reads_are_not_actions(self):
        self.assertEqual(canon.canon_call({"method": "GET", "path": "/devices", "body": None, "status": 200}), [])
        self.assertEqual(canon.canon_call(self.call({"action": "status", "target": "ac"})), [])
        self.assertTrue(canon.is_read(self.call({"action": "status", "target": "ac"})))

    def test_exact_partial_extra_and_duplicates(self):
        exp = [AC("temp", 24), L("on", "tusker edge")]
        self.assertTrue(canon.compare(exp, [L("on", "tusker edge"), AC("temp", 24)]).exact)
        m = canon.compare(exp, [AC("temp", 24)])
        self.assertEqual((m.exact, m.found, m.expected), (False, 1, 2))
        self.assertEqual(m.partial, 0.5)
        m = canon.compare(exp, exp + [DOOR("lock")])
        self.assertEqual(m.extra, [DOOR("lock")])
        m = canon.compare([DOOR("lock")], [DOOR("lock"), DOOR("lock")])
        self.assertTrue(m.duplicates)

    def test_wildcard_and_order(self):
        self.assertTrue(canon.compare([VOL("vol_up")], [VOL("vol_up", 7)]).exact)
        self.assertFalse(canon.compare([DOOR("lock"), AC("on")], [AC("on"), DOOR("lock")], ordered=True).exact)

    def test_best_alternative_wins(self):
        m, chosen = canon.best_compare([[L("on", "all")], [L("on", "tusker edge"), L("on", "tusker L1")]], [L("on", "tusker edge"), L("on", "tusker L1")])
        self.assertTrue(m.exact)
        self.assertEqual(len(chosen), 2)

    def test_invalid_reasons(self):
        self.assertEqual(canon.invalid_reasons({"flags": ["temp_out_of_range"], "schema_valid": False}), ["temp_out_of_range", "schema_invalid"])


class MockCmsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mock = MockCms().start()

    @classmethod
    def tearDownClass(cls):
        cls.mock.stop()

    def setUp(self):
        self.mock.reset()

    def post(self, body, path="/device-command", timeout=5):
        return requests.post(f"{self.mock.url}/api/internal/voice{path}", json=body, headers={"x-voice-secret": SECRET}, timeout=timeout)

    def test_set_temperature_changes_state_and_status_reads_it_back(self):
        self.assertEqual(self.post({"action": "ac_command", "target": "ac", "command": "set_temp", "params": {"temp": 23}}).status_code, 200)
        msg = self.post({"action": "status", "target": "ac"}).json()["data"]["message"]
        self.assertIn("23", msg)

    def test_error_shape_matches_the_real_api(self):
        r = self.post({"action": "lights_on", "target": "tusker L9"})
        self.assertEqual(r.status_code, 400)
        body = r.json()
        self.assertFalse(body["success"])
        self.assertEqual(body["error"]["code"], "AMBIGUOUS_TARGET")
        self.assertIn("couldn't find exactly one device", body["error"]["message"])

    def test_zod_like_validation(self):
        r = self.post({"action": "lights_set", "target": "tusker edge", "brightness": 150})
        self.assertEqual(r.status_code, 400)
        self.assertFalse(self.mock.calls[-1]["schema_valid"])

    def test_out_of_range_temperature_is_flagged_not_hidden(self):
        self.post({"action": "ac_command", "target": "ac", "command": "set_temp", "params": {"temp": 5}})
        self.assertIn("temp_out_of_range", self.mock.calls[-1]["flags"])

    def test_wrong_secret_is_refused(self):
        r = requests.post(f"{self.mock.url}/api/internal/voice/device-command", json={"action": "lock"}, headers={"x-voice-secret": "nope"}, timeout=5)
        self.assertEqual(r.status_code, 401)

    def test_unknown_light_colour_lists_the_real_ones(self):
        r = self.post({"action": "lights_set", "target": "tusker edge", "color": "infrared"})
        self.assertIn("colours I can do are", r.json()["error"]["message"])

    def test_screen_content_resolution_and_state(self):
        r = self.post({"action": "assign_media", "screen": "tusker 86", "content": "company presentation"}, "/screen-command")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.mock.fixtures.screens["main-screen"]["mediaName"], "Company Presentation")
        wrong = self.post({"action": "assign_experience", "screen": "tusker 86", "content": "company presentation"}, "/screen-command")
        self.assertIn("The experiences are:", wrong.json()["error"]["message"])

    def test_timeout_fault_is_logged_on_arrival(self):
        self.mock.reset(fault={"mode": "timeout", "sleep": 1.0})
        with self.assertRaises(requests.Timeout):
            self.post({"action": "lock"}, timeout=0.3)
        self.assertEqual(len(self.mock.calls), 1)  # counted even though it never answered
        self.assertIsNone(self.mock.calls[0]["status"])

    def test_stopped_server_refuses_connections(self):
        self.mock.stop()
        with self.assertRaises(requests.ConnectionError):
            self.post({"action": "lock"}, timeout=1)
        self.mock.reset()  # restart for the other tests
        self.assertEqual(self.post({"action": "lock"}).status_code, 200)

    def test_fault_modes(self):
        for mode, status in (("http400", 400), ("http401", 401), ("http403", 403), ("http500", 500), ("device_unavailable", 400)):
            self.mock.reset(fault={"mode": mode})
            self.assertEqual(self.post({"action": "lock"}).status_code, status, mode)


def _trace(reply="", said=True, **kw):
    base = dict(reply=reply, error=None, shutdown=False, said=[(time.perf_counter(), reply)] if said and reply else [], tools=[], gate=None,
                llm_start=None, llm_end=None, path="llm", intent=None, t0=time.perf_counter(), t_end=time.perf_counter())
    base.update(kw)
    return SimpleNamespace(**base)


def _post(body, status=200, path="/device-command", msg=""):
    return {"method": "POST", "path": path, "body": body, "status": status, "message": msg, "schema_valid": True, "flags": [], "seq": 1}


class JudgeTests(unittest.TestCase):
    mock = SimpleNamespace(fixtures=names.Fixtures.fresh())

    def ev(self, case, trace, calls):
        return judge.evaluate(case, trace, calls, self.mock)

    def test_execute_pass_and_fail(self):
        case = Case("t.ac", "basic", "set ac 24", "execute", expect=[AC("temp", 24)])
        ok = self.ev(case, _trace("AC set to 24 degrees."), [_post({"action": "ac_command", "target": "ac", "command": "set_temp", "params": {"temp": 24}})])
        self.assertTrue(ok["success"], ok["failures"])
        bad = self.ev(case, _trace("AC set to 42 degrees."), [_post({"action": "ac_command", "target": "ac", "command": "set_temp", "params": {"temp": 42}})])
        self.assertIn("missing_action", bad["failures"])

    def test_duplicate_and_extra_actions_are_caught(self):
        case = Case("t.lock", "basic", "lock", "execute", expect=[DOOR("lock")])
        calls = [_post({"action": "lock"}), _post({"action": "lock"}), _post({"action": "unlock"})]
        r = self.ev(case, _trace("Door locked."), calls)
        self.assertIn("duplicate_action", r["failures"])
        self.assertIn("extra_action", r["failures"])
        self.assertTrue(r["unintended_actions"])

    def test_clarify_must_not_act(self):
        case = Case("t.amb", "ambiguous", "turn it on", "clarify")
        good = self.ev(case, _trace("Which device do you mean?"), [])
        self.assertTrue(good["success"], good["failures"])
        guessed = self.ev(case, _trace("Done."), [_post({"action": "lights_on", "target": "tusker edge"})])
        self.assertIn("acted_instead_of_asking", guessed["failures"])

    def test_a_refused_guess_still_counts_against_the_model(self):
        case = Case("t.amb2", "ambiguous", "dim it", "clarify")
        r = self.ev(case, _trace("Which one?"), [_post({"action": "lights_set", "target": "the room", "brightness": 50}, 400, msg="couldn't find")])
        self.assertIn("guessed_before_asking", r["failures"])

    def test_invalid_values_are_flagged_even_when_the_cms_refused_them(self):
        case = Case("t.inv", "invalid", "500 percent", "invalid")
        call = _post({"action": "lights_set", "target": "tusker edge", "brightness": 500}, 400, msg="Invalid request.")
        call["schema_valid"] = False
        r = self.ev(case, _trace("That's out of range."), [call])
        self.assertIn("invalid_call_sent", r["failures"])

    def test_decline_styles(self):
        case = Case("t.dom", "domain_reject", "capital of France", "decline")
        self.assertTrue(self.ev(case, _trace("Sorry, I can only help with this room."), [])["success"])
        deflect = self.ev(case, _trace("I don't have that detail."), [])
        self.assertTrue(deflect["success"])
        self.assertEqual(deflect["detail"]["decline_style"], "deflected")
        engaged = self.ev(case, _trace("I don't have opinions on TV shows, but I can help you find it on the TV."), [])
        self.assertIn("engaged_with_off_topic", engaged["failures"])
        answered = self.ev(case, _trace("The capital of France is Paris."), [])
        self.assertFalse(answered["success"])
        called = self.ev(case, _trace("Sorry, I can only help with this room."), [_post({"action": "status", "target": "ac"})])
        self.assertIn("cms_called_for_off_topic", called["failures"])

    def test_fabricated_success_is_caught(self):
        case = Case("t.fab", "context", "turn them off", "execute", expect=[L("off", "all")])
        r = self.ev(case, _trace("Turned off3 lights."), [])
        self.assertIn("claimed_action_without_acting", r["failures"])
        r2 = self.ev(Case("t.fab2", "wake", "Travis was saying", "silent", transcript=True), _trace("I'll increase the brightness."), [])
        self.assertIn("claimed_action_without_acting", r2["failures"])

    def test_state_questions_need_a_read(self):
        case = Case("t.info", "relevant_info", "is the display on", "info", reply_any=["showing"])
        r = self.ev(case, _trace("The display is off."), [])
        self.assertIn("stated_state_without_reading", r["failures"])

    def test_error_cases_need_an_honest_reply(self):
        case = Case("t.err", "errors", "unlock", "error", inject={"mode": "http500"})
        failed = [_post({"action": "unlock"}, 500, msg="Something went wrong.")]
        self.assertTrue(self.ev(case, _trace("Something went wrong."), failed)["success"])
        lie = self.ev(case, _trace("Door unlocked."), failed)
        self.assertIn("false_or_missing_failure_report", lie["failures"])
        silent = self.ev(case, _trace(""), failed)
        self.assertIn("no_feedback", silent["failures"])

    def test_mixed_scope_wording(self):
        case = Case("t.mix", "domain_mixed", "unlock and joke", "execute", expect=[DOOR("unlock")], reply_none=["knock"], tags=["mixed_scope"])
        ok = self.ev(case, _trace("The door is unlocked. I can't help with the rest."), [_post({"action": "unlock"})])
        self.assertTrue(ok["success"], ok["failures"])
        spurious = self.ev(Case("t.s", "basic", "unlock", "execute", expect=[DOOR("unlock")]), _trace("Door unlocked. I can't help with the rest."), [_post({"action": "unlock"})])
        self.assertIn("spurious_rest_notice", spurious["failures"])

    def test_glued_numbers_are_detected(self):
        self.assertEqual(judge.glued_numbers("The AC is set to22 degrees at tusker L1"), ["to2"])
        self.assertEqual(judge.glued_numbers("tusker L1 is on"), [])

    def test_state_check(self):
        mock = SimpleNamespace(fixtures=names.Fixtures.fresh())
        mock.fixtures.screens["main-screen"]["mediaName"] = "Company Presentation"
        self.assertTrue(judge.state_holds(mock, {"screens.main-screen.mediaName": "Company Presentation"}))
        self.assertFalse(judge.state_holds(mock, {"screens.kiosk.mediaName": "Company Presentation"}))


class CaseSuiteTests(unittest.TestCase):
    def test_ids_are_unique_and_every_kind_is_known(self):
        flat = flatten(all_cases())
        ids = [c.id for c in flat]
        self.assertEqual(len(ids), len(set(ids)))
        known = {"execute", "partial", "clarify", "invalid", "rejected_ok", "decline", "info", "info_free", "unsupported", "error", "silent", "scenario", "noop"}
        self.assertLessEqual({c.kind for c in all_cases()}, known)
        self.assertGreater(len(flat), 300)

    def test_every_execute_case_has_an_expectation(self):
        for c in flatten(all_cases()):
            if c.kind == "execute":
                self.assertTrue(c.expect or c.any_of, c.id)

    def test_presets_used_by_cases_exist(self):
        from bench.voice_bench.runner_text import PRESETS

        for c in flatten(all_cases()):
            if c.setup:
                self.assertIn(c.setup, PRESETS, c.id)


class ReportTests(unittest.TestCase):
    def test_report_builds_from_a_tiny_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            case = Case("t.ac", "basic", "set ac 24", "execute", expect=[AC("temp", 24)])
            mock = SimpleNamespace(fixtures=names.Fixtures.fresh())
            row = judge.evaluate(case, _trace("AC set to 24 degrees.", path="fast", intent="AC_SET_TEMPERATURE"),
                                 [_post({"action": "ac_command", "target": "ac", "command": "set_temp", "params": {"temp": 24}})], mock)
            row.update(repeat=0, scenario=None, turn=None)
            bad = judge.evaluate(Case("t.dom", "domain_reject", "capital", "decline"), _trace("The capital is Paris."), [], mock)
            bad.update(repeat=0, scenario=None, turn=None)
            (out / "text_results.jsonl").write_text("\n".join(json.dumps(r, default=str) for r in (row, bad)), encoding="utf-8")
            path = report.build(out)
            text = path.read_text(encoding="utf-8")
            self.assertIn("1 passed / 1 failed", text)
            self.assertIn("Domain gate", text)
            self.assertTrue((out / "failures.md").exists())
            self.assertIn("t.dom", (out / "failures.md").read_text(encoding="utf-8"))
            self.assertIn("text", json.loads((out / "summary.json").read_text(encoding="utf-8")))


if __name__ == "__main__":
    unittest.main()
