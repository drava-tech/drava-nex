"""What Travis claims, and what it proposes instead of doing.

1. Capabilities: one description (nlu/capabilities.py) covering every action Travis runs; an unsupported request is declined honestly.
2. Device state / success claims: a state nobody read is never stated, a failed or unanswered command is never reported as done, a read or a
   confirmed command still is.
3. Statements ("it's too cold in here"): a concrete proposal from CMS state or a default, executed only after a yes; unclear statements do nothing.
"""

import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

import requests  # noqa: E402

from actions import cms_client  # noqa: E402
from nlu import capabilities  # noqa: E402
from nlu.plan import OPS, parse_plan  # noqa: E402
from nlu.suggest import propose  # noqa: E402
from safety.reply_guard import ToolResult, claims_state, compose, unverified_state_reply  # noqa: E402
from tests.test_planner import _planned, _say  # noqa: E402


def ac(power=True, temp=20):
    return {"id": "ac", "name": "tusker ac", "type": "ir", "state": {"power": power, "temp": temp}}


def light(name, on, level=None):
    return {"id": name, "name": name, "type": "light", "state": {"on": on, "brightness": level}}


class CapabilityDescriptionTests(unittest.TestCase):
    def test_every_action_travis_runs_is_in_the_description(self):
        grouped = [op for _, ops, _ in capabilities.EXECUTABLE for op in ops]
        self.assertEqual(sorted(grouped), sorted(OPS), "an op is missing from, or repeated in, nlu/capabilities.py")

    def test_text_separates_do_read_and_cannot(self):
        text = capabilities.text()
        for part in ("CAN DO", "CAN READ BACK", "CANNOT READ BACK", "CANNOT DO", "whiteboard", "muted"):
            self.assertIn(part, text)

    def test_a_capability_question_is_answered_from_the_design_not_from_what_is_online(self):
        self.assertIn("volume up, volume down, mute", capabilities.about("change the volume"))
        self.assertIn("temperature", capabilities.about("control the AC"))
        self.assertIsNone(capabilities.about("open a whiteboard"))

    def test_readability_matches_what_the_room_state_route_can_answer(self):
        self.assertTrue(capabilities.can_read("lights") and capabilities.can_read("ac"))
        self.assertFalse(capabilities.can_read("volume") or capabilities.can_read("door") or capabilities.can_read("unknown thing"))


class StateClaimTests(unittest.TestCase):
    def test_a_state_nobody_read_is_a_claim(self):
        for text in ("The TV is muted.", "It's muted. Want me to unmute it?", "The volume is at 40%.", "The soundbar is connected.", "The door is locked."):
            with self.subTest(text=text):
                self.assertTrue(claims_state(text))

    def test_an_admission_a_hedge_or_an_unrelated_sentence_is_not(self):
        for text in ("I can't tell whether it is muted.", "I can't check the current sound level. Would you like me to turn the volume up?",
                     "It might be muted.", "I can't open a whiteboard by voice yet.", "Which screen would you like?"):
            with self.subTest(text=text):
                self.assertFalse(claims_state(text))

    def test_the_model_saying_it_is_muted_is_replaced_before_it_is_spoken(self):
        a = _planned("")
        out = asyncio.run(a._speak_checked("The TV is currently muted.", []))
        self.assertEqual(out, unverified_state_reply())
        self.assertEqual(a.said, [unverified_state_reply()])

    def test_an_honest_limitation_with_an_offer_is_spoken_as_written(self):
        a = _planned("")
        text = "I can't check the current sound level. Would you like me to turn the volume up?"
        self.assertTrue(asyncio.run(a._speak_checked(text, [])).startswith("I can't check the current sound level."))


class SuccessIsOnlyWhatTheCmsConfirmedTests(unittest.TestCase):
    def test_a_failed_command_is_never_confirmed(self):
        failed = ToolResult("device_control", {"action": "ac_command", "command": "set_temp", "params": {"temp": 24}}, False, "Could not reach the CMS.")
        said = compose([failed])
        self.assertEqual(said, "Could not reach the CMS.")
        self.assertNotIn("24", said)

    def test_a_confirmed_command_is_confirmed(self):
        ok = ToolResult("device_control", {"action": "ac_command", "command": "set_temp", "params": {"temp": 24}}, True, "ok")
        self.assertEqual(compose([ok]), "AC set to 24 degrees.")

    def test_a_command_that_timed_out_waiting_for_the_reply_is_unknown_not_failed_and_not_done(self):
        timeout = requests.exceptions.ReadTimeout("slow")
        self.assertIn("can't tell whether", cms_client._unreachable("POST", timeout))
        self.assertEqual(cms_client._unreachable("POST", requests.exceptions.ConnectTimeout("never connected")), "Could not reach the CMS.")
        self.assertEqual(cms_client._unreachable("GET", timeout), "Could not reach the CMS.")
        self.assertEqual(cms_client._unreachable("POST", requests.exceptions.ConnectionError("refused")), "Could not reach the CMS.")

    def test_a_command_the_cms_failed_is_reported_as_failed(self):
        a = _planned("", json.dumps({"kind": "actions", "actions": [
            {"quote": "set the AC to 22", "op": "ac_set_temperature", "target": {"type": "ac", "scope": "unspecified"}, "parameters": {"temperature": 22}}]}))
        a.tool_ok = False
        _say(a, "set the AC to 22")
        spoken = " ".join(a.said)
        self.assertNotIn("AC set to 22", spoken)
        self.assertIn("CMS", spoken)


class ProposalTests(unittest.TestCase):
    def test_too_cold_raises_the_ac_to_the_default_when_it_is_below_it(self):
        p = propose("warmer", [ac(True, 20)])
        self.assertEqual(p.offer, "raise the AC temperature to 24 degrees")
        self.assertEqual(p.basis, "The AC is set to 20 degrees.")
        self.assertEqual(p.calls[0][1]["params"], {"temp": 24})

    def test_without_a_reading_the_configured_default_is_used_and_no_temperature_is_invented(self):
        p = propose("warmer", [])
        self.assertEqual(p.offer, "raise the AC temperature to 24 degrees")
        self.assertEqual(p.basis, "")
        self.assertEqual(propose("warmer", [], {"comfort_temp": 25}).calls[0][1]["params"], {"temp": 25})

    def test_already_past_the_default_it_steps_from_where_it_is_and_never_past_the_limit(self):
        self.assertEqual(propose("warmer", [ac(True, 26)]).calls[0][1]["params"], {"temp": 28})
        self.assertEqual(propose("warmer", [ac(True, 29)]).calls[0][1]["params"], {"temp": 30})
        self.assertIsNone(propose("warmer", [ac(True, 30)]))
        self.assertEqual(propose("cooler", [ac(True, 27)]).offer, "lower the AC temperature to 24 degrees")
        self.assertIsNone(propose("cooler", [ac(True, 16)]))

    def test_an_ac_that_is_off_is_not_adjusted(self):
        self.assertIsNone(propose("warmer", [ac(False, 0)]))

    def test_lights(self):
        self.assertEqual(propose("brighter", [light("a", False), light("b", False)]).offer, "turn the lights on")
        self.assertEqual(propose("brighter", [light("a", True, 50)]).calls[0][1]["brightness"], 80)
        self.assertEqual(propose("dimmer", [light("a", True, 100)]).calls[0][1]["brightness"], 40)
        self.assertIsNone(propose("brighter", [light("a", True, 90)]))
        self.assertIsNone(propose("dimmer", [light("a", False)]))
        self.assertIsNone(propose("brighter", []))

    def test_sound_has_no_readback_so_it_says_so_and_offers_the_nearest_action(self):
        p = propose("louder", [])
        self.assertEqual(p.basis, "I can't check the current sound level.")
        self.assertEqual(p.offer, "turn the volume up")
        self.assertEqual(p.calls[0][1]["command"], "Volume Up")
        self.assertEqual(propose("quieter", []).calls[0][1]["command"], "Volume Down")


def suggest(need, quote):
    return json.dumps({"kind": "suggest", "actions": [], "need": need, "need_quote": quote})


class StatementRouteTests(unittest.TestCase):
    def agent(self, *answers, devices=None):
        a = _planned("", *answers)
        a._refresh_world = lambda: None
        p = mock.patch("agent.suggest_route.cms_client.list_devices", lambda fresh=False: [ac(True, 20)] if devices is None else devices)
        p.start()
        self.addCleanup(p.stop)
        return a

    def test_parse_keeps_one_need_and_drops_a_suggestion_with_actions(self):
        self.assertEqual(parse_plan(suggest("warmer", "it's too cold")).need, "warmer")
        bad = parse_plan(json.dumps({"kind": "suggest", "actions": [], "need": "spicier", "need_quote": "x"}))
        self.assertEqual(bad.kind, "other")

    def test_too_cold_is_proposed_and_nothing_is_sent_until_yes(self):
        a = self.agent(suggest("warmer", "it's too cold in here"))
        _say(a, "It's too cold in here")
        self.assertEqual(a.calls, [])
        self.assertIn("Would you like me to raise the AC temperature to 24 degrees?", " ".join(a.said))
        _say(a, "yes")
        self.assertEqual([c[1].get("params") for c in a.calls], [{"temp": 24}])

    def test_no_to_the_proposal_changes_nothing(self):
        a = self.agent(suggest("warmer", "it's too cold in here"))
        _say(a, "It's too cold in here")
        _say(a, "no")
        self.assertEqual(a.calls, [])

    def test_i_cannot_hear_anything_says_it_cannot_check_the_level_and_offers_volume_up(self):
        a = self.agent(suggest("louder", "I can't hear anything"))
        _say(a, "I can't hear anything")
        said = " ".join(a.said)
        self.assertIn("I can't check the current sound level.", said)
        self.assertIn("turn the volume up", said)
        self.assertNotIn("muted", said)
        self.assertEqual(a.calls, [])

    def test_without_a_sensible_target_a_short_question_is_asked_and_nothing_runs(self):
        a = self.agent(suggest("warmer", "it's too cold in here"), devices=[ac(False, 0)])
        _say(a, "It's too cold in here")
        self.assertEqual(a.calls, [])
        self.assertIn("What temperature would you like", " ".join(a.said))

    def test_a_statement_the_planner_does_not_understand_does_nothing(self):
        a = self.agent(json.dumps({"kind": "other", "actions": []}))
        asked = []

        async def model(command):
            asked.append(command)
            a.said.append("model")
            return "model"

        a._run_llm = model
        _say(a, "It feels weird in here")
        self.assertEqual(a.calls, [])
        self.assertFalse(getattr(a, "_confirm", None) and a._confirm.fresh)

    def test_a_suggestion_whose_words_were_not_said_is_not_proposed(self):
        a = self.agent(suggest("warmer", "it is freezing"))
        fell_back = []

        async def model(command):
            fell_back.append(command)
            a.said.append("model")
            return "model"

        a._run_llm = model
        _say(a, "Hello there")
        self.assertEqual(a.calls, [])
        self.assertNotIn("Would you like me to", " ".join(a.said))


class MisreadSuggestionTests(unittest.TestCase):
    """The model may call a request or a question a "statement": the sentence's own form decides, and nothing is proposed or done for them."""

    def test_form_of_the_sentence(self):
        from nlu.room_state import sentence_form

        for text, form in (("It's too cold in here", "statement"), ("I can't hear anything", "statement"), ("Hey Travis, it's freezing", "statement"),
                           ("Why is the AC so cold", "question"), ("Can I see the portfolio", "question"),
                           ("Make it warmer", "request"), ("Please make it brighter", "request"), ("Show me the portfolio", "request")):
            with self.subTest(text=text):
                self.assertEqual(sentence_form(text), form)

    def agent(self, *answers):
        a = _planned("", *answers)
        a._refresh_world = lambda: None
        p = mock.patch("agent.suggest_route.cms_client.list_devices", lambda fresh=False: [ac(True, 20)])
        p.start()
        self.addCleanup(p.stop)
        return a

    def test_a_request_without_a_value_asks_for_it_instead_of_proposing_a_default(self):
        a = self.agent(suggest("warmer", "make it warmer"))
        _say(a, "Make it warmer")
        said = " ".join(a.said)
        self.assertIn("What temperature would you like", said)
        self.assertNotIn("Would you like me to", said)
        self.assertEqual(a.calls, [])

    def test_a_question_is_never_taken_for_a_complaint(self):
        a = self.agent(suggest("cooler", "why is the AC so cold"))
        asked = []

        async def model(command):
            asked.append(command)
            a.said.append("model")
            return "model"

        a._run_llm = model
        _say(a, "Why is the AC so cold")
        self.assertEqual(a.calls, [])
        self.assertNotIn("Would you like me to", " ".join(a.said))
        self.assertNotIn("What temperature", " ".join(a.said))


class BrightnessWithoutALightTests(unittest.TestCase):
    """"Set brightness of light to 80 percent" names no light: the word "light" is not a pointer to the last-used one."""

    def test_a_noun_is_not_a_pointer_but_pronouns_are(self):
        from nlu.resolver import points_back

        for words in ("it", "them", "the second one", "that one", "those", "the same one"):
            self.assertTrue(points_back(words), words)
        for words in ("light", "the light", "brightness of light", ""):
            self.assertFalse(points_back(words), words)

    def test_the_planner_writing_light_as_a_reference_asks_which_light_instead_of_using_the_last_one(self):
        a = _planned("", json.dumps({"kind": "actions", "actions": [
            {"quote": "set brightness of light to 80 percent", "op": "light_set",
             "target": {"words": "light", "type": "light", "scope": "reference", "index": 1}, "parameters": {"brightness": 80}}]}))
        a._focus.remember("light", ["tusker L3"])  # the sky light was just used
        _say(a, "Set brightness of light to 80 percent")
        self.assertEqual(a.calls, [])
        self.assertIn("Which light", " ".join(a.said))

    def test_the_level_that_was_set_is_what_is_confirmed_when_the_cms_sentence_has_none(self):
        done = ToolResult("device_control", {"action": "lights_set", "target": "tusker L3", "brightness": 80}, True, "tusker L3 is now on.")
        self.assertEqual(compose([done]), "The sky light is at 80%.")
        has_level = ToolResult("device_control", {"action": "lights_set", "target": "tusker edge", "brightness": 80}, True, "tusker edge is on at 80%.")
        self.assertEqual(compose([has_level]), "cove light is on at 80%.")


class CapabilityRequestRoutingTests(unittest.TestCase):
    def test_a_request_to_do_something_is_not_answered_from_the_knowledge_file_but_a_question_about_the_cms_is(self):
        a = _planned("")
        probed = []

        async def probe(request):
            probed.append(request)
            return None

        async def model(command):
            a.said.append("model")
            return "model"

        a._probe_knowledge, a._run_llm = probe, model
        asyncio.run(a._gated_model("can you open a whiteboard on a screen", "can you open a whiteboard on a screen", False))
        self.assertEqual(probed, [])
        asyncio.run(a._gated_model("does the cms support whiteboards", "does the cms support whiteboards", False))
        self.assertEqual(probed, ["does the cms support whiteboards"])


if __name__ == "__main__":
    unittest.main()
