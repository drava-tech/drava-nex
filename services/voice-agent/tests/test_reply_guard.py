import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from safety.reply_guard import ToolResult, claims_action, clean_cms_message, compose, unverified_reply, with_wake_hint  # noqa: E402


def dev(action, ok=True, message="msg", **args):
    return ToolResult("device_control", {"action": action, **args}, ok, message)


class ClaimsActionTests(unittest.TestCase):
    def test_claims_are_caught(self):
        for t in ("Turned off3 lights.", "Done.", "The AC is now on.", "I'll increase the brightness.", "Let me turn that on for you.",
                  "I've locked the door.", "tusker edge is on at 80%.", "Door unlocked.", "The company presentation has been shown."):
            with self.subTest(t=t):
                self.assertTrue(claims_action(t))

    def test_questions_refusals_and_chat_are_not(self):
        for t in ("Which light do you mean?", "I couldn't find that device.", "I can only help with this room.", "I have two screens.",
                  "Sorry, I didn't catch that.", "I don't have that detail.", "I'm not sure which one you meant."):
            with self.subTest(t=t):
                self.assertFalse(claims_action(t))


class ComposeTests(unittest.TestCase):
    def test_ac_confirmations_come_from_the_arguments(self):
        cases = [
            (dev("ac_command", command="power_on"), "The AC is on."),
            (dev("ac_command", command="power_off"), "The AC is off."),
            (dev("ac_command", command="set_temp", params={"temp": 22}), "AC set to 22 degrees."),
            (dev("ac_command", command="set_mode", params={"mode": "cool"}), "AC set to cool mode."),
            (dev("ac_command", command="set_fan", params={"fan": "high"}), "AC fan set to high."),
        ]
        for r, want in cases:
            with self.subTest(want=want):
                self.assertEqual(compose([r]), want)

    def test_other_actions_use_the_cms_sentence(self):
        self.assertEqual(compose([dev("lock", message="Door locked.")]), "Door locked.")

    def test_a_failure_is_spoken_as_a_failure(self):
        self.assertEqual(compose([dev("lock", ok=False, message="The device didn't respond.")]), "The device didn't respond.")

    def test_never_says_success_for_a_failed_ac_command(self):
        spoken = compose([dev("ac_command", ok=False, message="Not authorized.", command="set_temp", params={"temp": 22})])
        self.assertEqual(spoken, "Not authorized.")

    def test_several_results_are_joined_and_repeats_dropped(self):
        spoken = compose([dev("lock", message="Door locked."), dev("all_lights_off", message="Turned off 3 lights."), dev("lock", message="Door locked.")])
        self.assertEqual(spoken, "Door locked. Turned off 3 lights.")

    def test_instructions_for_a_model_are_not_spoken(self):
        spoken = compose([dev("lights_on", ok=False, message='I couldn\'t find exactly one device matching "x". Which one did you mean? The devices are: a, b. Only offer these.')])
        self.assertNotIn("Only offer these", spoken)
        self.assertTrue(spoken.endswith("Say the wake word, then your answer."))

    def test_results_that_need_interpreting_return_none(self):
        self.assertIsNone(compose([ToolResult("knowledge_search", {"query": "x"}, True, "long text")]))
        self.assertIsNone(compose([dev("lock", message="Door locked."), ToolResult("knowledge_search", {"query": "x"}, True, "t")]))

    def test_silent_tools_say_nothing(self):
        self.assertEqual(compose([ToolResult("save_memory", {}, True, "ok")]), "")

    def test_is_action(self):
        self.assertTrue(dev("lock").is_action)
        self.assertFalse(dev("status", target="ac").is_action)
        self.assertFalse(ToolResult("list_inventory", {}, True, "x").is_action)
        self.assertTrue(ToolResult("screen_control", {"action": "stop"}, True, "x").is_action)


class SmallHelpersTests(unittest.TestCase):
    def test_wake_hint_only_on_questions_and_only_once(self):
        self.assertEqual(with_wake_hint("Door locked."), "Door locked.")
        self.assertEqual(with_wake_hint("Which one?"), "Which one? Say the wake word, then your answer.")
        again = "Which one? Say the wake word, then the name."
        self.assertEqual(with_wake_hint(again), again)

    def test_clean_cms_message(self):
        self.assertEqual(clean_cms_message("Which? The screens are: a, b. Only offer these."), "Which? The screens are: a, b.")

    def test_unverified_reply_does_not_claim_anything(self):
        self.assertFalse(claims_action(unverified_reply()))


class WithoutContactTests(unittest.TestCase):
    def test_contact_sentences_are_removed_and_the_rest_kept(self):
        from safety.reply_guard import without_contact

        text = ("The Travis control system is the voice assistant built by White Tusker. It controls this space. "
                "You can reach us at hello at thewhitetusker dot com.")
        self.assertEqual(without_contact(text), "The Travis control system is the voice assistant built by White Tusker. It controls this space.")

    def test_phone_and_email_words_and_addresses_go_too(self):
        from safety.reply_guard import without_contact

        self.assertEqual(without_contact("It runs the screens. Email hello@thewhitetusker.com for more. Call us on 99001."), "It runs the screens.")

    def test_text_without_contact_is_unchanged(self):
        from safety.reply_guard import without_contact

        self.assertEqual(without_contact("The CMS controls lights, the AC and screens."), "The CMS controls lights, the AC and screens.")

    def test_a_reply_that_is_only_contact_becomes_empty(self):
        from safety.reply_guard import without_contact

        self.assertEqual(without_contact("You can reach us at hello at thewhitetusker dot com."), "")


if __name__ == "__main__":
    unittest.main()
