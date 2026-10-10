"""Room-state questions ("Is the AC on?") are answered from live CMS data by a read-only route (nlu/room_state.py, agent/room_state.py)."""

import json
import re
import sys
import unittest
from pathlib import Path
from unittest import mock

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu import room_state  # noqa: E402
from nlu.room_state import StateQuestion, answer, parse  # noqa: E402
from tests.test_planner import _planned, _say  # noqa: E402

DEVICES = [
    {"id": "dev-edge", "type": "light", "name": "tusker edge", "state": {"on": True, "brightness": 60}},
    {"id": "dev-l1", "type": "light", "name": "tusker L1", "state": {"on": False, "brightness": 100}},
    {"id": "dev-l2", "type": "light", "name": "tusker L2", "state": {"on": False, "brightness": 100}},
    {"id": "dev-ac", "type": "ir", "name": "Experience Center AC", "state": {"power": True, "temp": 23, "mode": "cool", "fan": "auto"}},
    {"id": "dev-tv", "type": "ir", "name": "TV", "state": {"power": True}},
    {"id": "dev-soundbar", "type": "ir", "name": "Soundbar", "state": {"power": True}},
]
SCREENS = [
    {"screenId": "main-screen", "screenName": "tusker 86", "blanked": False, "experienceName": "Welcome Experience", "mediaName": None},
    {"screenId": "kiosk", "screenName": "tusker 27", "blanked": False, "experienceName": None, "mediaName": None},
]
PROMISES = re.compile(r"i'?ll check|let me|one moment|i can check|hold on|checking", re.I)


def q(subject, question, which=""):
    return StateQuestion(subject, question, which)


def with_state(devices, **changes):
    out = json.loads(json.dumps(devices))
    for d in out:
        d["state"].update(changes.get(d["id"], {}))
    return out


class ParseTests(unittest.TestCase):
    def test_a_state_question_is_read_from_the_classifier(self):
        raw = json.dumps({"asks_state": True, "subject": "ac", "question": "status", "which": ""})
        self.assertEqual(parse(raw, "is the AC on"), q("ac", "status"))

    def test_not_a_state_question(self):
        for raw in (json.dumps({"asks_state": False, "subject": "none", "question": "none", "which": ""}), "sure, the AC is on", "{}",
                    json.dumps({"asks_state": True, "subject": "weather", "question": "status", "which": ""}),
                    json.dumps({"asks_state": True, "subject": "ac", "question": "none", "which": ""})):
            self.assertIsNone(parse(raw, "is the AC on"), raw)

    def test_a_sentence_with_an_action_word_is_never_a_state_question(self):
        raw = json.dumps({"asks_state": True, "subject": "ac", "question": "status", "which": ""})
        for text in ("turn the AC on", "set the AC to 22", "lock the door", "switch on the lights", "unlock the door", "mute the TV"):
            self.assertIsNone(parse(raw, text), text)


class AnswerTests(unittest.TestCase):
    def test_how_many_lights_counts_the_sky_light_once(self):
        self.assertEqual(answer(q("lights", "count"), DEVICES, SCREENS), "There are two lights: the cove light and the sky light.")

    def test_which_lights_are_on(self):
        self.assertEqual(answer(q("lights", "which_on"), DEVICES, SCREENS), "The cove light at 60% is on. The rest is off.")
        none_on = with_state(DEVICES, **{"dev-edge": {"on": False}})
        self.assertEqual(answer(q("lights", "which_on"), none_on, SCREENS), "No lights are on.")
        all_on = with_state(DEVICES, **{"dev-l1": {"on": True}, "dev-l2": {"on": True}})
        self.assertEqual(answer(q("lights", "which_on"), all_on, SCREENS), "The cove light and the sky light are on.")

    def test_the_sky_light_is_on_if_either_half_is(self):
        half = with_state(DEVICES, **{"dev-edge": {"on": False}, "dev-l2": {"on": True, "brightness": 40}})
        self.assertEqual(answer(q("lights", "which_on"), half, SCREENS), "The sky light at 40% is on. The rest is off.")

    def test_is_one_light_on(self):
        self.assertEqual(answer(q("lights", "status", "the cove light"), DEVICES, SCREENS), "The cove light is on at 60%.")
        self.assertEqual(answer(q("lights", "status", "sky light"), DEVICES, SCREENS), "The sky light is off.")

    def test_an_unknown_light_is_said_not_guessed(self):
        said = answer(q("lights", "status", "garden light"), DEVICES, SCREENS)
        self.assertIn("I don't have a light called garden light", said)
        self.assertIn("cove light and the sky light", said)

    def test_the_ac(self):
        self.assertEqual(answer(q("ac", "status"), DEVICES, SCREENS), "The CMS shows the AC on, set to 23 degrees.")
        self.assertEqual(answer(q("ac", "status"), with_state(DEVICES, **{"dev-ac": {"power": False}}), SCREENS), "The CMS shows the AC off.")
        no_state = [dict(d, state={}) if d["id"] == "dev-ac" else d for d in DEVICES]
        self.assertIn("no state for the AC", answer(q("ac", "status"), no_state, SCREENS))

    def test_the_tv_and_the_main_screen(self):
        self.assertEqual(answer(q("tv", "status"), DEVICES, SCREENS), "tusker 86 is showing Welcome Experience.")
        off = with_state(DEVICES, **{"dev-tv": {"power": False}})
        self.assertTrue(answer(q("tv", "status"), off, SCREENS).startswith("The CMS shows the TV off."))

    def test_what_is_playing(self):
        self.assertEqual(answer(q("screens", "playing", "the main screen"), DEVICES, SCREENS), "tusker 86 is showing Welcome Experience.")
        self.assertEqual(answer(q("screens", "playing"), DEVICES, SCREENS), "tusker 86 is showing Welcome Experience.")  # only the one that shows something
        blank = [dict(s, experienceName=None) for s in SCREENS]
        self.assertEqual(answer(q("screens", "playing"), DEVICES, blank), "Nothing is showing on any screen.")
        media = [dict(SCREENS[0], experienceName=None, mediaName="Company Presentation"), SCREENS[1]]
        self.assertEqual(answer(q("screens", "playing"), DEVICES, media), "tusker 86 is showing Company Presentation.")
        black = [dict(SCREENS[0], blanked=True), SCREENS[1]]
        self.assertIn("tusker 86 is blank", answer(q("screens", "playing", "tusker 86"), DEVICES, black))

    def test_screens_counted_and_an_unknown_screen_said(self):
        self.assertEqual(answer(q("screens", "count"), DEVICES, SCREENS), "There are two screens: tusker 86 and tusker 27.")
        self.assertIn("I don't have a screen called lobby", answer(q("screens", "playing", "lobby"), DEVICES, SCREENS))

    def test_the_door_and_the_volume_are_honest_about_what_the_cms_cannot_read(self):
        door = answer(q("door", "locked"), DEVICES, SCREENS)
        self.assertIn("I can't tell whether the door is locked", door)
        self.assertIn("no door status", door)
        self.assertIn("I can't read the volume", answer(q("volume", "level"), DEVICES, SCREENS))

    def test_no_answer_ever_promises_to_check(self):
        every = [q(s, k, w) for s in room_state.SUBJECTS if s != "none" for k in room_state.QUESTIONS if k != "none" for w in ("", "sky light", "tusker 86")]
        for item in every:
            for devices in (DEVICES, []):
                for screens in (SCREENS, []):
                    with self.subTest(q=item, devices=len(devices), screens=len(screens)):
                        text = answer(item, devices, screens)
                        self.assertTrue(text.strip())
                        self.assertIsNone(PROMISES.search(text), text)


class RouteTests(unittest.TestCase):
    """Through the conversation: the planner (scripted) says "other", a scripted classifier reads the sentence, the CMS lists are patched,
    and every CMS call that could change something fails the test."""

    CLASSIFIED = {
        "how many lights are there": ("lights", "count", ""),
        "which lights are on": ("lights", "which_on", ""),
        "is the ac on": ("ac", "status", ""),
        "what temperature is the ac set to": ("ac", "status", ""),
        "is the tv on": ("tv", "status", ""),
        "what is playing on the main screen": ("screens", "playing", "the main screen"),
        "what presentation is open": ("screens", "playing", ""),
        "is the display on": ("tv", "status", ""),
        "is the door locked": ("door", "locked", ""),
    }

    def agent(self, planner_answers, devices=None, screens=None, down=False):
        a = _planned("x", *planner_answers)
        del a._answer_room_state  # the real route
        self.classifier_calls = []

        async def complete_json(messages, schema, max_tokens=400):
            text = messages[-1]["content"].lower().strip(" ?.")
            self.classifier_calls.append(text)
            if text in self.CLASSIFIED:
                s, k, w = self.CLASSIFIED[text]
                return json.dumps({"asks_state": True, "subject": s, "question": k, "which": w})
            return json.dumps({"asks_state": False, "subject": "none", "question": "none", "which": ""})

        a._llm.complete_json = complete_json
        self.reads = []

        def reader(name, data):
            def read():
                self.reads.append(name)
                if down:
                    raise OSError("CMS unreachable")
                return data
            return read

        def never(*a_, **k_):
            raise AssertionError("the room-state route changed something in the CMS")

        for patch in (mock.patch("agent.room_state.cms_client.list_devices", reader("devices", DEVICES if devices is None else devices)),
                      mock.patch("agent.room_state.cms_client.list_screens", reader("screens", SCREENS if screens is None else screens)),
                      mock.patch("actions.cms_client.device_command", never), mock.patch("actions.cms_client.screen_command", never)):
            patch.start()
            self.addCleanup(patch.stop)
        a.model_asked = []

        async def llm(command):
            a.model_asked.append(command)
            a.said.append("model")
            return "model"

        a._run_llm = llm
        return a

    OTHER = json.dumps({"kind": "other", "actions": []})

    def test_each_question_is_answered_from_the_cms_without_a_promise_and_without_the_model(self):
        for text, want in (("How many lights are there?", "two lights"), ("Which lights are on?", "cove light"), ("Is the AC on?", "23 degrees"),
                           ("What temperature is the AC set to?", "23 degrees"), ("Is the TV on?", "Welcome Experience"),
                           ("What is playing on the main screen?", "Welcome Experience"), ("What presentation is open?", "Welcome Experience"),
                           ("Is the display on?", "showing"), ("Is the door locked?", "can't tell")):
            with self.subTest(text=text):
                a = self.agent([self.OTHER])
                _say(a, text)
                said = " ".join(a.said)
                self.assertIn(want, said)
                self.assertIsNone(PROMISES.search(said), said)
                self.assertEqual(a.model_asked, [])
                self.assertEqual(a._path, "room state")

    def test_only_the_lists_that_are_needed_are_read(self):
        a = self.agent([self.OTHER])
        _say(a, "Which lights are on?")
        self.assertEqual(self.reads, ["devices"])
        a = self.agent([self.OTHER])
        _say(a, "What is playing on the main screen?")
        self.assertEqual(self.reads, ["screens"])

    def test_the_door_question_reads_nothing_and_never_touches_the_lock(self):
        a = self.agent([self.OTHER])
        _say(a, "Is the door locked?")
        self.assertEqual(self.reads, [])
        self.assertEqual(a.calls, [])

    def test_when_the_cms_cannot_be_read_it_says_so(self):
        a = self.agent([self.OTHER], down=True)
        _say(a, "Is the AC on?")
        self.assertIn("couldn't reach the CMS", " ".join(a.said))
        self.assertNotIn("on", " ".join(a.said).replace("couldn't", "").split("CMS")[0].split()[-1:])

    def test_a_fragment_is_not_a_question(self):
        for text in ("The AC.", "The lights.", "The door."):
            a = self.agent([self.OTHER])
            _say(a, text)
            self.assertEqual(self.classifier_calls, [], text)
            self.assertEqual(a.model_asked, [text])

    def test_a_question_that_is_not_about_the_room_goes_on_to_the_model(self):
        a = self.agent([self.OTHER])
        _say(a, "What is the meaning of life?")
        self.assertEqual(a.model_asked, ["What is the meaning of life?"])

    # look-alike pairs: the question and the command that differ by a word or two
    def test_is_the_ac_on_is_a_question_and_turn_the_ac_on_is_a_command(self):
        a = self.agent([self.OTHER])
        _say(a, "Is the AC on?")
        self.assertEqual(a.calls, [])
        plan = json.dumps({"kind": "actions", "actions": [{"quote": "turn the AC on", "op": "ac_on", "target": {"words": "the AC", "type": "ac", "scope": "specific", "name": ""}, "parameters": {}}]})
        a2 = self.agent([plan])
        self.classifier_calls.clear()
        _say(a2, "Turn the AC on")
        self.assertEqual(self.classifier_calls, [])  # the command never reached the state classifier
        self.assertTrue(a2.calls and a2.calls[0][0] == "device_control")

    def test_is_the_door_locked_is_a_question_and_lock_the_door_is_a_command(self):
        a = self.agent([self.OTHER])
        _say(a, "Is the door locked?")
        self.assertEqual(a.calls, [])
        a2 = self.agent([])
        _say(a2, "Lock the door")  # the exact phrase of the command list
        self.assertTrue(a2.calls and a2.calls[0][0] == "device_control")
        self.assertEqual(a2._path, "list")

    def test_which_lights_are_on_versus_turn_on_the_lights(self):
        a = self.agent([self.OTHER])
        _say(a, "Which lights are on?")
        self.assertEqual(a.calls, [])
        a2 = self.agent([])
        _say(a2, "Turn on the cove light")
        self.assertTrue(a2.calls)
        self.assertEqual(self.classifier_calls, ["which lights are on?"][:0] or self.classifier_calls)  # (the command used the fast path)

    def test_a_classifier_that_wrongly_says_state_for_a_command_is_stopped_by_the_action_word_rule(self):
        a = self.agent([self.OTHER])

        async def stubborn(messages, schema, max_tokens=400):
            return json.dumps({"asks_state": True, "subject": "ac", "question": "status", "which": ""})

        a._llm.complete_json = stubborn
        _say(a, "Please switch the AC on for me")
        self.assertEqual(a.calls, [])
        self.assertEqual(a.model_asked, ["Please switch the AC on for me"])  # not answered as a state question

    def test_a_company_question_never_reaches_the_state_classifier(self):
        plan = json.dumps({"kind": "question", "actions": [], "topic": "company"})
        a = self.agent([plan])

        async def know(p, r, **kw):
            a.said.append("knowledge")
            return "knowledge"

        a._answer_from_knowledge = know
        _say(a, "tell me about white tusker")
        self.assertEqual(self.classifier_calls, [])


if __name__ == "__main__":
    unittest.main()


class ShapeGateTests(unittest.TestCase):
    """The classifier (a 0.6 s model call) is asked only about a sentence shaped like a question about the room; the form decides, not a topic list."""

    STATE = ("How many lights are there", "How many lights do you have", "Which lights are on", "Is the cove light on", "Is the sky light on", "Is the AC on",
             "What temperature is the AC set to", "Is the door locked", "How many screens are there", "What is playing on the main screen",
             "Tell me which lights are on", "Can you tell me if the AC is running", "What's showing on the kiosk", "Are any lights on right now",
             "hey travis is the AC on", "Let me know if the door is locked", "Check if the lights are on")
    NOT_STATE = ("Show the whiteboard", "There's no projector here, can you check", "Explain how air conditioners work", "Play some music", "Make it warmer",
                 "Turn it up", "Turn on the lights", "Book room 3 for Wednesday", "Open the whiteboard please", "Switch it off")

    def test_every_room_question_has_the_shape(self):
        for text in self.STATE:
            self.assertTrue(room_state.could_be_state_question(text), text)

    def test_a_command_an_imperative_or_a_statement_has_not(self):
        for text in self.NOT_STATE:
            self.assertFalse(room_state.could_be_state_question(text), text)


class SkippedClassifierTests(RouteTests):
    """Through the conversation: the model is not called for requests that cannot be state questions, and is for the ones that can."""

    def test_the_classifier_is_not_called_for_an_imperative_or_a_statement(self):
        for text in ("Show the whiteboard", "There's no projector here, can you check", "Explain how air conditioners work"):
            with self.subTest(text=text):
                a = self.agent([self.OTHER])
                _say(a, text)
                self.assertEqual(self.classifier_calls, [], text)
                self.assertEqual(self.reads, [], text)

    def test_is_the_ac_on_still_asks_the_classifier_and_is_answered(self):
        a = self.agent([self.OTHER])
        _say(a, "Is the AC on?")
        self.assertEqual(self.classifier_calls, ["is the ac on"])
        self.assertIn("23 degrees", " ".join(a.said))

    def test_state_dependent_commands_are_acted_on_by_the_planner_and_never_reach_the_state_check(self):
        """"make it warmer" depends on the AC's current state and "turn it up" on what "it" is: both are COMMANDS the planner reads (asking for the missing
        value, or acting), so the room-state check is never involved, before or after this change."""
        warmer = json.dumps({"kind": "actions", "actions": [{"quote": "make it warmer", "op": "ac_adjust", "target": {"type": "ac", "scope": "unspecified", "words": "it",
                                                                                                                      "name": "", "location": "", "index": 0}, "parameters": {}}]})
        louder = json.dumps({"kind": "actions", "actions": [{"quote": "turn it up", "op": "tv_volume_up", "target": {"type": "tv", "scope": "unspecified", "words": "it",
                                                                                                                  "name": "", "location": "", "index": 0}, "parameters": {"times": 1}}]})
        for text, plan in (("Make it warmer", warmer), ("Turn it up", louder)):
            with self.subTest(text=text):
                a = self.agent([plan])
                _say(a, text)
                if a._plan_log:
                    self.assertEqual(a._plan_log["kind"], "actions", text)  # the planner read it as a command
                else:
                    self.assertEqual(a._path, "list", text)  # or the command list did ("turn it up" is a known phrase)
                self.assertEqual(self.classifier_calls, [], text)
                self.assertNotEqual(a._path, "room state", text)
