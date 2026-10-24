"""A title said slightly wrong is suggested back ("Did you mean ...?") and pushed only after a yes."""

import asyncio
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu import title_match  # noqa: E402
from tests.test_local_agent import _agent  # noqa: E402

EXPERIENCES = ["Mountain Flow", "Tusker Experience", "Welcome Reel 2024"]
MEDIA = ["Lobby Loop", "Mountain Flow Teaser", "Product Launch"]


class SuggestTests(unittest.TestCase):
    def test_sounds_like(self):
        self.assertEqual(title_match.suggest("mountain flows", EXPERIENCES)[0][0], "Mountain Flow")
        self.assertEqual(title_match.suggest("tuscar experiance", EXPERIENCES)[0][0], "Tusker Experience")
        self.assertEqual(title_match.suggest("lobi loop", MEDIA)[0][0], "Lobby Loop")
        self.assertEqual(title_match.suggest("product lunch", MEDIA)[0][0], "Product Launch")

    def test_unrelated_is_not_suggested(self):
        self.assertEqual(title_match.suggest("banana split", EXPERIENCES + MEDIA), [])

    def test_a_different_number_is_a_different_title(self):
        self.assertEqual(title_match.suggest("welcome reel 2025", EXPERIENCES), [])
        lights = ["tusker edge", "tusker L1", "tusker L2"]
        self.assertEqual(title_match.suggest("tusker L9", lights), [])  # not L1, not "edge"
        self.assertEqual(title_match.suggest("tusker L 2", lights)[0][0], "tusker L2")


class ConfirmTests(unittest.TestCase):
    def setUp(self):
        a = self.a = _agent()
        a._pending = None
        a._confirm = None
        a.pushed = []

        async def titles():
            return EXPERIENCES, MEDIA

        async def call_tool(name, args):
            a.calls.append((name, args))
            if name != "screen_control":
                return True, "ok"
            kind = "experience" if args["action"] == "assign_experience" else "media item"
            known = EXPERIENCES if kind == "experience" else MEDIA
            if args["content"] in known:
                a.pushed.append(args)
                return True, f"Showing {args['content']} on {args['screen']}."
            return False, f'I couldn\'t find exactly one {kind} matching "{args["content"]}". Which one did you mean?'

        a._content_titles = titles
        a._call_tool = call_tool

    def say(self, text):
        self.a.said.clear()
        asyncio.run(self.a._run_command(text))
        return " ".join(self.a.said)

    def ask(self, content, action="assign_content"):
        self.a.said.clear()
        ok, msg = asyncio.run(self.a._assign_content({"action": action, "content": content, "screen": "tusker edge"}))
        return ok, msg

    def test_close_title_is_asked_then_pushed_on_yes(self):
        ok, msg = self.ask("mountain flows")
        self.assertFalse(ok)
        self.assertIn("Did you mean Mountain Flow, the experience?", msg)
        self.assertIn("the wake word, yes or no", msg)
        self.assertEqual(self.a.pushed, [])  # nothing pushed before the yes
        reply = self.say("yes")
        self.assertEqual(self.a.pushed, [{"action": "assign_experience", "screen": "tusker edge", "content": "Mountain Flow"}])
        self.assertIn("Mountain Flow", reply)
        self.assertIsNone(self.a._confirm)

    def test_media_title_is_offered_as_media(self):
        _, msg = self.ask("lobi loop")
        self.assertIn("Lobby Loop, the media item", msg)
        self.say("yeah")
        self.assertEqual(self.a.pushed[0]["action"], "assign_media")

    def test_no_offers_one_more_then_asks_to_repeat(self):
        _, first = self.ask("mountain flow tease")
        self.assertIn("Did you mean Mountain Flow Teaser", first)
        second = self.say("no")
        self.assertIn("How about Mountain Flow, the experience", second)
        last = self.say("no")
        self.assertIn("repeat the command", last)
        self.assertEqual(self.a.pushed, [])
        self.assertIsNone(self.a._confirm)

    def test_yes_to_the_second_suggestion_pushes_it(self):
        self.ask("mountain flow tease")
        self.say("no")
        self.say("yes")
        self.assertEqual(self.a.pushed[0]["content"], "Mountain Flow")

    def test_a_new_command_drops_the_question(self):
        self.ask("mountain flows")
        self.say("turn on tusker edge")
        self.assertIsNone(self.a._confirm)
        self.assertEqual(self.a.pushed, [])
        self.assertIn("not waiting", self.say("yes"))

    def test_never_mind(self):
        self.ask("mountain flows")
        self.assertIn("left it as it is", self.say("never mind"))
        self.assertEqual(self.a.pushed, [])

    def test_the_question_lapses(self):
        self.ask("mountain flows")
        self.a._confirm.expires = 0.0
        self.assertIn("not waiting", self.say("yes"))
        self.assertEqual(self.a.pushed, [])

    def test_nothing_similar_lists_real_names(self):
        ok, msg = self.ask("banana split")
        self.assertFalse(ok)
        self.assertIsNone(self.a._confirm)
        self.assertIn("The experiences are: Mountain Flow", msg)
        self.assertNotIn("media", msg.lower())  # the media library is not read out unless asked

    def test_media_is_listed_only_when_media_was_asked_for(self):
        ok, msg = self.ask("banana split", action="assign_media")
        self.assertFalse(ok)
        self.assertIn("The media items are: Lobby Loop", msg)
        self.assertNotIn("experiences are", msg)

    def test_explicit_kind_only_suggests_that_kind(self):
        _, msg = self.ask("mountain flow tease", action="assign_experience")
        self.assertIn("the experience", msg)
        self.assertNotIn("Teaser", msg)

    def test_exact_title_pushes_straight_away(self):
        ok, _ = self.ask("Mountain Flow")
        self.assertTrue(ok)
        self.assertIsNone(self.a._confirm)


class NearMissTests(unittest.TestCase):
    """Devices, screens and modes the CMS can't find: the closest real name is asked about,
    whichever path made the call (command list or model)."""

    REAL = {"device": ["tusker edge", "tusker L1", "tusker L2"], "screen": ["tusker edge"], "mode": ["meeting", "presentation"]}

    def setUp(self):
        a = self.a = _agent()
        a._pending = a._confirm = None
        a.sent = []

        async def pool(kind):
            return self.REAL[kind]

        async def call_tool(name, args):
            kind, field = ("screen", "screen") if name == "screen_control" else ("device", "target")
            if args.get("action") == "ambient_mode":
                kind = "mode"
            if str(args.get(field)).lower() in [n.lower() for n in self.REAL[kind]]:
                a.sent.append((name, args))
                return True, f"Done: {args.get(field)}."
            return False, f'''I couldn't find exactly one {kind} matching "{args.get(field)}". Which one did you mean? Only offer these.'''

        a._name_pool = pool
        a._call_tool = call_tool

    def run_call(self, utterance, name, args, strict=False):
        self.a._utterance = utterance
        res = asyncio.run(self.a._run_guarded(name, args, strict=strict))
        return " ".join(r.message for r in res)

    def say(self, text):
        self.a.said.clear()
        asyncio.run(self.a._run_command(text))
        return " ".join(self.a.said)

    def test_light_near_miss_then_yes(self):
        msg = self.run_call("turn on tusker edje", "device_control", {"action": "lights_on", "target": "tusker edje"})
        self.assertIn("Did you mean tusker edge, the device?", msg)
        self.assertEqual(self.a.sent, [])
        self.say("yes")
        self.assertEqual(self.a.sent, [("device_control", {"action": "lights_on", "target": "tusker edge"})])

    def test_works_for_a_call_the_model_made(self):
        msg = self.run_call("turn on tusker edje", "device_control", {"action": "lights_on", "target": "tusker edje"}, strict=True)
        self.assertIn("Did you mean tusker edge", msg)
        self.say("yes")
        self.assertEqual(len(self.a.sent), 1)

    def test_screen_near_miss_keeps_the_rest_of_the_call(self):
        msg = self.run_call("play the video on tusker edje", "screen_control", {"action": "play", "screen": "tusker edje"})
        self.assertIn("the screen", msg)
        self.say("yes")
        self.assertEqual(self.a.sent, [("screen_control", {"action": "play", "screen": "tusker edge"})])

    def test_mode_near_miss(self):
        msg = self.run_call("meeting mode", "device_control", {"action": "ambient_mode", "target": "meating"})
        self.assertIn("Did you mean meeting, the mode?", msg)

    def test_a_different_number_is_never_suggested(self):
        msg = self.run_call("turn on tusker L9", "device_control", {"action": "lights_on", "target": "tusker L9"})
        self.assertNotIn("Did you mean", msg)
        self.assertIsNone(self.a._confirm)

    def test_only_one_question_per_sentence(self):
        a = self.a
        a._utterance = "turn on tusker edje and tusker L 3"
        first = asyncio.run(a._offer_close_names("device_control", {"action": "lights_on", "target": "tusker edje"},
                                                 '''I couldn't find exactly one device matching "tusker edje".'''))
        second = asyncio.run(a._offer_close_names("device_control", {"action": "lights_on", "target": "tusker lx"},
                                                  '''I couldn't find exactly one device matching "tusker lx".'''))
        self.assertIsNotNone(first)
        self.assertIsNone(second)

    def test_an_unrelated_error_is_left_alone(self):
        msg = self.run_call("lock the door", "device_control", {"action": "lock"})
        self.assertNotIn("Did you mean", msg)


if __name__ == "__main__":
    unittest.main()
