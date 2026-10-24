"""The planner path: what was MEANT -> a structured plan -> real targets -> checked CMS calls.

The model is replaced by canned plans (what a correct reading of each sentence looks like); everything
after it is the production code: parsing, the quote check, target resolution, grounding of numbers
and names, pending questions, and what is said back. tests/test_local_agent.py covers the command list.
"""

import asyncio
import json
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu.plan import parse_plan, quote_supported  # noqa: E402
from nlu.resolver import ALL  # noqa: E402
from tests.test_local_agent import _agent, _hear  # noqa: E402


def act(op, quote, ttype="none", scope="none", name="", location="", index=0, words="", **parameters):
    target = {"words": words, "type": ttype, "scope": scope, "name": name, "location": location, "index": index}
    return {"quote": quote, "op": op, "target": {k: v for k, v in target.items() if v not in ("", 0)}, "parameters": parameters}


def plan(*actions, kind="actions", question=""):
    return json.dumps({"kind": kind, "actions": list(actions), "question": question})


def all_lights(op, quote, **parameters):
    return act(op, quote, "light", "all", **parameters)


class _FakeChat:
    model = "fake"

    def __init__(self, *answers):
        self._answers = list(answers)
        self.requests = []

    async def complete_json(self, messages, schema, max_tokens=400):
        self.requests.append(messages)
        return self._answers.pop(0)


def _planned(heard, *answers, **state):
    """An agent with the planner on and the model scripted to answer with `answers` in turn."""
    a = _agent(heard, **state)
    chat = _FakeChat(*answers)
    a._init_planner(chat, "PLANNER", a._registry, a._guard, 120.0)
    a._refresh_world = lambda: None  # no CMS here
    a._portfolio_skip_until = float('inf')  # nor a portfolio lookup (PortfolioOfferTests turn it back on)

    async def no_probe(request):  # nor a knowledge search for requests the planner leaves alone (ProbeTests delete this)
        return None

    a._probe_knowledge = no_probe

    async def no_state(request):  # nor the room-state check (tests/test_room_state.py deletes this)
        return None

    a._answer_room_state = no_state
    a._canned_tried, a._canned_matcher = True, None  # nor the written-down FAQ / small-talk answers (tests/test_canned.py sets its own matcher)
    a.chat = chat
    return a


def _say(a, command):
    """One more command in the same conversation (the wake word is already handled)."""
    asyncio.run(a._run_command(command))


def sent(a):
    """The (action, target, other args) of every call that reached the CMS."""
    return [{k: v for k, v in args.items()} for _, args in a.calls]


class ParsePlanTests(unittest.TestCase):
    def test_a_well_formed_plan(self):
        p = parse_plan(plan(all_lights("light_set", "set all lights to 80", brightness=80)))
        self.assertEqual(p.kind, "actions")
        self.assertEqual((p.actions[0].op, p.actions[0].target.scope, p.actions[0].parameters), ("light_set", "all", {"brightness": 80}))

    def test_garbage_and_unknown_ops_are_not_plans(self):
        self.assertIsNone(parse_plan("sure, turning the lights on"))
        self.assertIsNone(parse_plan('{"kind": "banana"}'))
        p = parse_plan(plan({"quote": "x", "op": "launch_rocket", "target": {}}, question="Which one?"))
        self.assertEqual((p.kind, p.actions, p.question), ("clarify", [], "Which one?"))

    def test_empty_values_the_model_writes_for_nothing_are_nothing(self):
        p = parse_plan(plan(act("light_off", "x", "light", "specific", name="null", color="")))
        self.assertEqual((p.actions[0].target.name, p.actions[0].parameters), ("", {}))

    def test_quotes_must_really_have_been_said(self):
        self.assertTrue(quote_supported("Turn on the lights", "Can you turn on the lights please?"))
        self.assertTrue(quote_supported("set all lights to 80 percent", "Set all lights to 80%"))
        self.assertFalse(quote_supported("lock the door", "Can you dim everything to 80?"))
        self.assertFalse(quote_supported("", "anything"))


class OneMeaningManyWordsTests(unittest.TestCase):
    """Different sentences, the same reading -> the same structured action and the same CMS calls."""

    SENTENCES = [
        "Set all lights to 80 percent.",
        "Set the brightness of all lights to 80 percent.",
        "Make every light 80%.",
        "Put all the lights at 80.",
        "Increase all the lights to 80 percent brightness.",
        "Can you make all the lights 80% bright?",
        "Set every light's brightness to 80.",
    ]

    def test_all_lights_to_80(self):
        for text in self.SENTENCES:
            with self.subTest(text=text):
                a = _planned(f"Hey Travis {text}", plan(all_lights("light_set", text.rstrip(".?"), brightness=80)))
                a._light_names_fn = lambda: ["tusker edge", "tusker L1", "tusker L2"]
                _hear(a)
                self.assertEqual(
                    [(c["action"], c["target"], c["brightness"]) for c in sent(a)],
                    [("lights_set", n, 80) for n in ("tusker edge", "tusker L1", "tusker L2")],
                )
                self.assertEqual(a.said, ["All lights are at 80%."])  # one sentence, not every light's name
                self.assertIn("light all", a._plan_log["actions"][0]["target"])

    def test_the_planner_is_not_asked_what_the_command_list_already_knows(self):
        a = _planned("Hey Travis turn on tusker edge", plan())
        _hear(a)
        self.assertEqual(a.chat.requests, [])  # exact known phrase: the shortcut, no model
        self.assertEqual(sent(a), [{"action": "lights_on", "target": "tusker edge"}])

    def test_turning_all_lights_on_or_off(self):
        for text, op, action in (("Switch every light on, please.", "light_on", "all_lights_on"), ("Light everything up.", "light_on", "all_lights_on"),
                                 ("Could you put out all the lighting?", "light_off", "all_lights_off")):
            with self.subTest(text=text):
                a = _planned(f"Hey Travis {text}", plan(all_lights(op, text.rstrip(".?,"))))
                _hear(a)
                self.assertEqual(sent(a), [{"action": action}])

    def test_one_named_light_by_the_name_the_room_uses(self):
        a = _planned("Hey Travis could you bring the cove light down to 60?", plan(act("light_set", "bring the cove light down to 60", "light", "specific", name="cove light", brightness=60)))
        _hear(a)
        self.assertEqual(sent(a), [{"action": "lights_set", "target": "tusker edge", "brightness": 60}])  # the CMS's own name

    def test_light_and_ac_in_one_sentence(self):
        a = _planned(
            "Hey Travis set all lights to 80 percent and AC to 24",
            plan(all_lights("light_set", "set all lights to 80 percent", brightness=80), act("ac_set_temperature", "AC to 24", "ac", temperature=24)),
        )
        a._light_names_fn = lambda: ["tusker edge"]
        _hear(a)
        self.assertEqual([c["action"] for c in sent(a)], ["lights_set", "ac_command"])
        self.assertEqual(sent(a)[1]["params"], {"temp": 24})


class NeverGuessTests(unittest.TestCase):
    def test_an_action_the_user_did_not_ask_for_is_dropped(self):
        # the model adds a door lock to "dim everything to 80": it cannot quote anything for it
        a = _planned(
            "Hey Travis can you dim everything to 80",
            plan(all_lights("light_set", "dim everything to 80", brightness=80), act("door_lock", "lock the door")),
        )
        a._light_names_fn = lambda: ["tusker edge"]
        _hear(a)
        self.assertEqual([c["action"] for c in sent(a)], ["lights_set"])
        self.assertTrue(any("door_lock dropped" in n for n in a._plan_log["resolved"]))

    def test_the_door_still_needs_its_own_words_even_with_a_quote(self):
        a = _planned("Hey Travis could you turn on the room please", plan(act("door_lock", "turn on the room")))
        _hear(a)
        self.assertEqual(sent(a), [])  # guard: nothing in the request asked for the lock
        self.assertTrue(a.said)

    def test_a_number_nobody_said_is_not_sent(self):
        a = _planned("Hey Travis make the lights a bit brighter", plan(all_lights("light_set", "make the lights a bit brighter", brightness=80)))
        _hear(a)
        self.assertEqual(sent(a), [])
        self.assertIn("What brightness would you like", a.said[0])

    def test_a_temperature_out_of_range_is_asked_about(self):
        a = _planned("Hey Travis set the AC to 5 degrees", plan(act("ac_set_temperature", "set the AC to 5 degrees", "ac", temperature=5)))
        _hear(a)
        self.assertEqual(sent(a), [])
        self.assertIn("16 to 30", a.said[0])

    def test_a_screen_the_model_picked_by_itself_is_not_used(self):
        a = _planned(
            "Hey Travis turn on the lights and show the welcome video",
            plan(all_lights("light_on", "turn on the lights"), act("screen_show", "show the welcome video", "screen", "specific", name="tusker 86", content="welcome video")),
        )
        _hear(a)
        self.assertEqual(sent(a), [{"action": "all_lights_on"}])  # the clear part ran
        self.assertIn("Which screen should I show welcome video on?", a.said[0])
        self.assertEqual(a._plan_pending.missing, "screen")

    def test_the_answer_completes_the_waiting_action(self):
        a = _planned(
            "Hey Travis show the welcome video",
            plan(act("screen_show", "show the welcome video", "screen", "none", content="welcome video")),
        )
        _hear(a)
        self.assertEqual(sent(a), [])

        async def assign(args):
            a.calls.append(("screen_control", args))
            return True, "Showing it."

        a._assign_content = assign
        _say(a, "the kiosk")
        self.assertEqual(sent(a), [{"action": "assign_content", "screen": "tusker 27", "content": "welcome video"}])

    def test_an_answer_that_is_a_whole_new_command_drops_the_question(self):
        a = _planned("Hey Travis make the lights dimmer", plan(all_lights("light_set", "make the lights dimmer")))
        _hear(a)
        self.assertIsNotNone(a._plan_pending)
        _say(a, "lock the door")
        self.assertEqual(sent(a), [{"action": "lock"}])
        self.assertIsNone(a._plan_pending)

    def test_the_level_answered_later_finishes_the_request(self):
        a = _planned("Hey Travis make the lights dimmer", plan(all_lights("light_set", "make the lights dimmer")))
        a._light_names_fn = lambda: ["tusker edge"]
        _hear(a)
        _say(a, "30")
        self.assertEqual(sent(a), [{"action": "lights_set", "target": "tusker edge", "brightness": 30}])


class TargetResolutionTests(unittest.TestCase):
    def test_a_place_with_no_matching_light_is_asked_about_not_run(self):
        a = _planned("Hey Travis set the bedroom lights to 80 percent", plan(act("light_set", "set the bedroom lights to 80 percent", "light", "group", location="bedroom", brightness=80)))
        _hear(a)
        self.assertEqual(sent(a), [])
        said = a.said[0]
        self.assertIn("couldn't find any lights in the bedroom", said)
        self.assertIn("the cove light or the sky light", said)  # the real choices, in the room's names
        self.assertNotIn("no device called", said)

    def test_an_unknown_light_name_names_the_real_ones(self):
        a = _planned("Hey Travis turn off the garden lamp", plan(act("light_off", "turn off the garden lamp", "light", "specific", name="garden lamp")))
        _hear(a)
        self.assertEqual(sent(a), [])
        self.assertIn("I couldn't find a light called garden lamp", a.said[0])

    def test_them_after_listing_the_lights(self):
        a = _planned("Hey Travis list all the lights you can control", plan(act("light_set", "set them to 50 percent", "light", "reference", words="them", brightness=50)))
        a._focus.remember("light", ["tusker edge", "tusker L3"])  # what the list just read out
        _say(a, "set them to 50 percent")
        self.assertEqual(sent(a), [{"action": "lights_set", "target": "tusker edge", "brightness": 50}, {"action": "lights_set", "target": "tusker L3", "brightness": 50}])
        self.assertEqual(a.said, ["The cove light and the sky light are at 50%."])

    def test_the_second_one(self):
        a = _planned("x", plan(act("light_off", "turn the second one off", "light", "reference", index=2, words="the second one")))
        a._focus.remember("light", ["tusker edge", "tusker L3"])
        _say(a, "turn the second one off")
        self.assertEqual(sent(a), [{"action": "lights_off", "target": "tusker L3"}])

    def test_them_with_nothing_to_refer_to_asks(self):
        a = _planned("x", plan(act("light_set", "set them to 50", "light", "reference", words="them", brightness=50)))
        _say(a, "set them to 50")
        self.assertEqual(sent(a), [])
        self.assertIn("Which light do you mean", a.said[0])

    def test_them_after_all_lights_were_set_means_all_lights(self):
        a = _planned("x", plan(all_lights("light_set", "set all lights to 80", brightness=80)), plan(act("light_off", "turn them off", "light", "reference", words="them")))
        a._light_names_fn = lambda: ["tusker edge"]
        _say(a, "set all lights to 80")
        self.assertEqual(a._focus.get("light"), [ALL])
        a.calls.clear()
        _say(a, "turn them off")
        self.assertEqual(sent(a), [{"action": "all_lights_off"}])

    def test_the_screen_on_the_left_is_not_guessed(self):
        a = _planned("x", plan(act("screen_show", "show intro on the screen on the left", "screen", "group", location="left", content="intro")))
        _say(a, "show intro on the screen on the left")
        self.assertEqual(sent(a), [])
        self.assertIn("couldn't tell which screen you mean", a.said[0])

    def test_conversation_and_chat_go_to_the_model(self):
        a = _planned("x", plan(kind="other"))

        async def llm(command):
            a.said.append(f"model: {command}")
            return "model"

        a._run_llm = llm
        _say(a, "what is the experience center")
        self.assertEqual(a.said, ["model: what is the experience center"])

    def test_cancel_runs_nothing(self):
        a = _planned("x", plan(kind="cancel"))
        _say(a, "turn on the lights, oh no, never mind that one")
        self.assertEqual(sent(a), [])
        self.assertEqual(a.said, ["Okay, I've left it as it is."])

    def test_an_answer_that_is_not_a_plan_falls_back_to_the_model(self):
        a = _planned("x", "I think you want the lights on")

        async def llm(command):
            a.said.append("model")
            return "model"

        a._run_llm = llm
        _say(a, "illuminate the whole venue")
        self.assertEqual(a.said, ["model"])


class AroundThePlanTests(unittest.TestCase):
    def test_the_off_topic_rest_of_a_request_is_named_not_answered(self):
        a = _planned(
            "x",
            json.dumps({"kind": "actions", "actions": [act("door_unlock", "unlock the door")], "leftover": "tell me a joke"}),
        )
        _say(a, "unlock the door and tell me a joke")
        self.assertEqual(sent(a), [{"action": "unlock"}])
        self.assertTrue(" ".join(a.said).endswith("I can't help with the rest."))

    def test_an_action_made_out_of_the_off_topic_part_is_dropped(self):
        a = _planned(
            "x",
            json.dumps({
                "kind": "actions",
                "actions": [act("door_unlock", "unlock the door"), act("screen_show", "tell me a joke", "screen", "none", content="a joke")],
                "leftover": "tell me a joke",
            }),
        )
        _say(a, "unlock the door and tell me a joke")
        self.assertEqual(sent(a), [{"action": "unlock"}])
        self.assertNotIn("Which screen", " ".join(a.said))

    def test_it_with_nothing_said_about_the_ac_or_the_tv_is_asked_about(self):
        a = _planned("x", plan(act("ac_set_temperature", "set it to 24", "ac", temperature=24)))
        _say(a, "set it to 24")
        self.assertEqual(sent(a), [])
        b = _planned("x", plan(act("tv_power", "turn it on", "tv", "specific")))
        _say(b, "turn it on")
        self.assertEqual(sent(b), [])

    def test_it_after_the_ac_was_just_used_means_the_ac(self):
        a = _planned("x", plan(act("ac_off", "turn it off", "ac", words="it")))
        _say(a, "set the AC to 24")  # the command list
        a.calls.clear()
        _say(a, "turn it off")
        self.assertEqual(sent(a), [{"action": "ac_command", "command": "power_off", "target": "ac"}])

    def test_a_leftover_the_user_never_said_is_ignored(self):
        a = _planned("x", json.dumps({"kind": "actions", "actions": [act("door_unlock", "unlock the door")], "leftover": "sing a song"}))
        _say(a, "unlock the door")
        self.assertNotIn("I can't help with the rest.", " ".join(a.said))

    def test_it_means_what_the_command_list_just_did(self):
        a = _planned("x", plan(act("light_off", "turn it off", "light", "reference", words="it")))
        _say(a, "turn on tusker edge")  # the command list
        a.calls.clear()
        _say(a, "turn it off")
        self.assertEqual(sent(a), [{"action": "lights_off", "target": "tusker edge"}])

    def test_it_in_the_same_sentence_means_the_light_just_named(self):
        a = _planned(
            "x",
            plan(
                act("light_on", "turn on the cove light", "light", "specific", name="cove light", words="the cove light"),
                act("light_set", "make it green", "light", "reference", words="it", color="green"),
            ),
        )
        _say(a, "turn on the cove light and make it green")
        self.assertEqual(sent(a), [{"action": "lights_on", "target": "tusker edge"}, {"action": "lights_set", "target": "tusker edge", "color": "green"}])

    def test_changes_to_one_light_are_one_call(self):
        a = _planned(
            "x",
            plan(
                act("light_set", "dim tusker L3 to 40 percent", "light", "specific", name="tusker L3", brightness=40),
                act("light_set", "make it warm white", "light", "reference", words="it", color="warm white"),
            ),
        )
        _say(a, "dim tusker L3 to 40 percent and make it warm white")
        self.assertEqual(sent(a), [{"action": "lights_set", "target": "tusker L3", "brightness": 40, "color": "warm white"}])

    def test_degrees_for_a_light_and_percent_for_the_ac_are_asked_about_per_action(self):
        a = _planned("x", plan(act("light_set", "set tusker edge to 24 degrees", "light", "specific", name="tusker edge", brightness=24)))
        _say(a, "set tusker edge to 24 degrees")
        self.assertEqual(sent(a), [])
        self.assertIn("not degrees", a.said[0])
        # ...but another action's unit in the same sentence is not this action's
        b = _planned(
            "x",
            plan(all_lights("light_set", "set all lights to 80 percent", brightness=80), act("ac_set_temperature", "the AC to 24 degrees", "ac", temperature=24)),
        )
        b._light_names_fn = lambda: ["tusker edge"]
        _say(b, "set all lights to 80 percent and the AC to 24 degrees")
        self.assertEqual([c["action"] for c in sent(b)], ["lights_set", "ac_command"])

    def test_a_volume_in_the_hundreds_is_asked_about(self):
        a = _planned("x", plan(act("volume_up", "turn the volume up by fifty", "tv", "specific", words="the volume", times=50)))
        _say(a, "turn the volume up by fifty")
        self.assertEqual(sent(a), [])

    def test_with_the_model_down_known_commands_still_run(self):
        from nlu.local_llm import LocalLLMError

        a = _planned("x", plan())

        async def down(messages, schema, max_tokens=400):
            raise LocalLLMError("Ollama isn't reachable")

        a.chat.complete_json = down
        _say(a, "turn off all the lights and set the AC to 22")
        self.assertEqual([c["action"] for c in sent(a)], ["all_lights_off", "ac_command"])
        _say(a, "make the place feel welcoming please")
        self.assertIn("language model isn't available", a.said[-1])

    def test_the_cms_is_not_read_for_a_request_that_is_not_about_the_room(self):
        a = _planned("x", plan(kind="other"))
        reads = []
        a._refresh_world = lambda: reads.append(1)

        async def llm(command):
            return "model"

        a._run_llm = llm
        _say(a, "what is the capital of france")
        self.assertEqual(reads, [])


if __name__ == "__main__":
    unittest.main()


class QuestionsAboutTheCompanyTests(unittest.TestCase):
    """Visitors also ask about White Tusker, the CMS and Travis: not device or screen actions."""

    def test_they_are_answered_from_the_knowledge_base_not_by_the_tool_calling_model_or_the_cms(self):
        for text, topic in (("what is the white tusker", "company"), ("what is this CMS", "cms"), ("how does Travis work", "travis")):
            with self.subTest(text=text):
                a = _planned("x", json.dumps({"kind": "question", "actions": [], "topic": topic}))
                seen = []

                async def answer(plan, request, seen=seen):
                    seen.append((plan.kind, plan.topic, request))
                    return "answer"

                async def never(command):
                    raise AssertionError("the tool-calling model must not decide whether to look anything up")

                a._answer_from_knowledge = answer
                a._run_llm = never
                _say(a, text)
                self.assertEqual(sent(a), [])
                self.assertEqual(seen, [("question", topic, text)])

    def test_a_company_question_skips_the_relevance_gate(self):
        # "tell me about white tusker" was declined as off topic by the gate even though the planner
        # had classed it as a company question; the knowledge base must get it.
        from types import SimpleNamespace

        a = _planned("x", json.dumps({"kind": "question", "actions": [], "topic": "company"}))

        async def deny(*args, **kwargs):
            raise AssertionError("the relevance gate must not see a question the planner classed")

        a._gate.review = deny
        seen = []

        async def answer(plan, request):
            seen.append(request)
            return "answer"

        a._answer_from_knowledge = answer
        _say(a, "tell me about white tusker")
        self.assertEqual(seen, ["tell me about white tusker"])
        self.assertFalse(getattr(a, "_off_topic", False))
        _ = SimpleNamespace

    def test_small_talk_is_not_sent_to_the_knowledge_base(self):
        a = _planned("x", json.dumps({"kind": "question", "actions": [], "topic": "chat"}))
        seen = []

        async def llm(command):
            seen.append(command)
            return "hello"

        a._run_llm = llm
        _say(a, "lovely weather we are having")
        self.assertEqual(seen, ["lovely weather we are having"])


class PortfolioOfferTests(unittest.TestCase):
    """From the FIRST real answer about White Tusker in a conversation (config `portfolio_offer_after`, default 1), Travis asks "Would you like me to play our portfolio on the main
    screen?" (once; never if it is already playing or was declined); yes plays it through the normal action path."""

    REPLY = "White Tusker is a brand experience design studio."
    OFFER = "Would you like me to play our portfolio on the main screen?"

    def _asked(self, topic="company", experiences=("White Tusker Portfolio", "Welcome Reel"), screens=("tusker 86", "tusker 27"),
               reply=None, times=1, playing=None, **cfg):
        from unittest import mock

        a = _planned("x", *[json.dumps({"kind": "question", "actions": [], "topic": topic})] * 5)
        text = self.REPLY if reply is None else reply

        async def answer(plan, request):
            a._new_conversation_check()
            a._kb_ok = "don't have that detail" not in text.lower()
            a._kb_last_topic = plan.topic
            if a._kb_ok and plan.topic == "company":
                a._kb_company_said = True
                a._company_answers += 1
            await a._say(text)
            return text

        a._answer_from_knowledge = answer
        a._portfolio_skip_until = 0.0
        config = {"portfolio_offer": True, **cfg}

        def list_screens():
            if screens is None:
                raise OSError("CMS unreachable")
            return [{"screenName": n, "blanked": False, "experienceName": playing if n == "tusker 86" else None} for n in screens]

        self._patches = [mock.patch("agent.planning.load_api_config", lambda: config),
                         mock.patch("agent.planning.cms_client.list_screens", list_screens),
                         mock.patch("agent.planning.cms_client.list_experiences", lambda: [{"title": t} for t in experiences])]
        for p in self._patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self._patches])
        for i in range(times):
            a.said.clear()
            _say(a, ["tell me about white tusker", "who are your clients", "where are you based"][i])
        return a

    def test_the_first_company_answer_is_followed_by_the_offer(self):
        a = self._asked()
        self.assertIsNotNone(a._confirm)
        self.assertIn("portfolio", " ".join(a.said).lower())

    def test_a_hyphenated_title_is_still_the_portfolio(self):
        """The real experience is titled "The White Tusker PORT-FOLIO": the offer must find it, and yes must play exactly that title."""
        a = self._asked(experiences=["Welcome Screen", "The White Tusker PORT-FOLIO", "Future Shopping"])
        self.assertIsNotNone(a._confirm)
        a.calls.clear()
        _say(a, "yes")
        self.assertEqual(a.calls, [("screen_control", {"action": "assign_experience", "screen": "tusker 86", "content": "The White Tusker PORT-FOLIO"})])

    def test_the_offer_can_wait_for_a_later_answer_through_the_config(self):
        self.assertIsNone(self._asked(times=1, portfolio_offer_after=2)._confirm)
        self.assertIsNotNone(self._asked(times=2, portfolio_offer_after=2)._confirm)

    def test_the_company_answer_ends_with_the_offer(self):
        a = self._asked()
        said = " ".join(a.said)
        self.assertIn(self.REPLY, said)
        self.assertIn(self.OFFER, said)
        self.assertIsNotNone(a._confirm)
        self.assertTrue(a._confirm.offer)

    def test_yes_plays_exactly_that_experience_on_the_main_screen(self):
        a = self._asked()
        a.calls.clear()
        _say(a, "yes")
        self.assertEqual(a.calls, [("screen_control", {"action": "assign_experience", "screen": "tusker 86", "content": "White Tusker Portfolio"})])

    def test_visitors_say_yes_and_no_in_their_own_words(self):
        for yes in ("yes", "yes please", "sure", "go ahead", "play it", "okay", "that would be great", "Hey Travis, yes please"):
            with self.subTest(yes=yes):
                a = self._asked()
                a.calls.clear()
                _say(a, yes)
                self.assertEqual([c[0] for c in a.calls], ["screen_control"], yes)
        for no in ("no", "no thanks", "not now", "maybe later", "nope"):
            with self.subTest(no=no):
                a = self._asked()
                a.calls.clear()
                a.said.clear()
                _say(a, no)
                self.assertEqual((a.calls, a.said), ([], ["Okay, no problem."]), no)

    def test_something_else_is_a_new_request_and_the_offer_lapses(self):
        a = self._asked()
        a.calls.clear()
        _say(a, "turn off the cove light")
        self.assertTrue(a.calls and a.calls[0][0] == "device_control")  # the new request ran
        self.assertIsNone(a._confirm)

    def test_no_drops_the_offer_and_it_is_never_made_again_in_this_conversation(self):
        a = self._asked()
        a.calls.clear()
        a.said.clear()
        _say(a, "no")
        self.assertEqual((a.calls, a.said), ([], ["Okay, no problem."]))
        self.assertIsNone(a._confirm)
        a.said.clear()
        _say(a, "where are you based")
        self.assertIsNone(a._confirm)
        self.assertNotIn("portfolio", " ".join(a.said).lower())

    def test_it_is_offered_once_not_after_every_answer(self):
        a = self._asked()
        a._confirm = None  # (the visitor answered something else)
        a.said.clear()
        _say(a, "where are you based")
        self.assertIsNone(a._confirm)
        self.assertNotIn("portfolio", " ".join(a.said).lower())

    def test_not_offered_if_it_is_already_playing_on_the_main_screen(self):
        a = self._asked(playing="White Tusker Portfolio")
        self.assertIsNone(a._confirm)
        self.assertNotIn("portfolio", " ".join(a.said).lower())

    def test_offered_if_something_else_is_playing(self):
        self.assertIsNotNone(self._asked(playing="Welcome Reel")._confirm)

    def test_a_new_conversation_starts_the_count_again(self):
        a = self._asked()
        a._confirm = None
        a._history, a._history_at = [], 0.0  # five minutes passed
        a.said.clear()
        _say(a, "who are your clients")
        self.assertIsNotNone(a._confirm)  # the first answer of a new conversation is offered the portfolio again

    def test_no_offer_for_the_cms_or_travis_or_the_place(self):
        for topic in ("cms", "travis", "experience_center"):
            with self.subTest(topic=topic):
                a = self._asked(topic=topic)
                self.assertIsNone(a._confirm)
                self.assertNotIn("portfolio", " ".join(a.said).lower())

    def test_nothing_is_offered_that_the_cms_does_not_have(self):
        for kw in ({"experiences": ("Welcome Reel",)},  # no portfolio at all
                   {"experiences": ("Portfolio A", "Portfolio B")},  # two: which one?
                   {"screens": ("tusker 27",)},  # no main screen
                   {"screens": None}):  # CMS unreachable
            with self.subTest(kw=kw):
                a = self._asked(**kw)
                self.assertIsNone(a._confirm)
                self.assertNotIn("portfolio", " ".join(a.said).lower())

    def test_the_experience_can_be_named_in_the_config_when_several_match(self):
        a = self._asked(experiences=("Portfolio A", "Portfolio B"), portfolio_experience="portfolio b")
        self.assertEqual(a._confirm.current.title, "Portfolio B")

    def test_an_i_dont_have_that_detail_answer_does_not_count(self):
        a = self._asked(reply="I don't have that detail.")
        self.assertIsNone(a._confirm)

    def test_the_offer_can_be_switched_off(self):
        a = self._asked(portfolio_offer=False)
        self.assertIsNone(a._confirm)

    def test_a_cms_that_does_not_answer_costs_at_most_the_limit_and_then_no_offer(self):
        """The lookup used to take 4.4 s with the CMS down. Now: at most `portfolio_lookup_timeout_sec`, no offer, and no new lookup for 60 s."""
        import time
        from unittest import mock

        def hangs():
            time.sleep(1.5)  # a CMS that is slow to refuse (the thread finishes on its own)
            return [{"title": "White Tusker Portfolio"}]

        a = self._asked_with(hangs, portfolio_lookup_timeout_sec=0.3)
        self.assertLess(a.turn_seconds, 1.0)  # (the turn itself; the abandoned thread finishes on its own)
        self.assertIsNone(a._confirm)
        self.assertNotIn("portfolio", " ".join(a.said).lower())
        self.assertGreater(a._portfolio_skip_until, time.monotonic() + 30)  # not asked again for a minute

    def test_the_lookup_starts_before_the_answer_and_is_not_repeated(self):
        import asyncio

        looks = []

        def list_experiences():
            looks.append(1)
            return [{"title": "White Tusker Portfolio"}]

        a = self._asked_with(list_experiences)
        self.assertEqual(len(looks), 1)  # one lookup: the one started by the prefetch, taken by the offer
        self.assertIsNotNone(a._confirm)
        self.assertIsNone(a._portfolio_task)  # consumed

    def test_prefetch_only_for_company_answers_that_could_get_an_offer(self):
        import asyncio

        a = self._asked_with(lambda: [{"title": "White Tusker Portfolio"}], topic="cms")
        self.assertIsNone(a._portfolio_task)  # not a company answer
        b = self._asked_with(lambda: [{"title": "White Tusker Portfolio"}])
        b._portfolio_offered = True
        asyncio.run(asyncio.sleep(0)) if False else None
        b._prefetch_portfolio("company")
        self.assertIsNone(b._portfolio_task)  # already offered in this conversation

    def _asked_with(self, list_experiences, topic="company", **cfg):
        from unittest import mock

        a = _planned("x", *[json.dumps({"kind": "question", "actions": [], "topic": topic})] * 5)

        async def answer(plan, request):
            a._new_conversation_check()
            a._kb_ok = True
            a._kb_last_topic = plan.topic
            if plan.topic == "company":
                a._kb_company_said = True
                a._company_answers += 1
            a._prefetch_portfolio(plan.topic)  # as agent/knowledge_answer.py does before it speaks
            await a._say(self.REPLY)
            return self.REPLY

        a._answer_from_knowledge = answer
        a._portfolio_skip_until = 0.0
        config = {"portfolio_offer": True, **cfg}
        patches = [mock.patch("agent.planning.load_api_config", lambda: config),
                   mock.patch("agent.planning.cms_client.list_screens", lambda: [{"screenName": "tusker 86", "blanked": False, "experienceName": None}]),
                   mock.patch("agent.planning.cms_client.list_experiences", list_experiences)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        import asyncio
        import time

        async def turn():
            started = time.perf_counter()
            await a._run_command("tell me about white tusker")
            return time.perf_counter() - started

        a.turn_seconds = asyncio.run(turn())
        return a

    def test_without_a_follow_up_window_the_offer_says_how_to_answer(self):
        a = self._asked(followup_window_sec=0)
        self.assertIn("Say the wake word, yes or no.", " ".join(a.said))
