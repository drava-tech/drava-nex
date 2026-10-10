"""Whisper's own doubt gates what runs, and the vocabulary prompt is command-shaped but safe
(2026-10-06: "turn off tusker edge" heard as "the screen"; sentence prompts fixed it but can fabricate commands)."""

import asyncio
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from agent.vocabulary import stt_names_prompt, stt_vocabulary  # noqa: E402
from speech.stt import Transcript  # noqa: E402
from tests.test_local_agent import REGISTRY, _FakeSTT, _agent  # noqa: E402


class PromptTests(unittest.TestCase):
    def test_commands_built_from_the_rooms_own_names(self):
        prompt, _ = stt_vocabulary(REGISTRY, {"wake_word_phrase": "hey travis"})
        self.assertTrue(prompt.startswith("Hey Travis."))
        self.assertIn("Turn off cove light.", prompt)  # the names visitors say, not the CMS's
        self.assertIn("Turn on sky light.", prompt)
        self.assertNotIn("tusker", prompt.lower())
        self.assertIn("Turn on the AC.", prompt)  # without it "turn on the AC" is heard as turn on <a light>

    def test_nothing_that_could_run_if_whisper_echoes_it_from_noise(self):
        prompt, _ = stt_vocabulary(REGISTRY, {})
        low = prompt.lower()
        for risky in ("lock", "degrees", "unlock", "good night", "shut"):
            self.assertNotIn(risky, low)

    def test_config_still_overrides(self):
        prompt, hot = stt_vocabulary(REGISTRY, {"stt_initial_prompt": "Custom.", "stt_hotwords": "a, b"})
        self.assertEqual(prompt, "Custom.")
        self.assertTrue(hot.startswith("a, b"))  # the company name is always added after the configured ones

    def test_the_company_name_is_a_hotword_and_in_the_fallback_prompt(self):
        _, hot = stt_vocabulary(REGISTRY, {"stt_hotwords": "turn on, tusker 86"})
        words = [w.strip() for w in hot.split(",")]
        self.assertIn("tusker", words)
        self.assertIn("white tusker", words)
        self.assertEqual(words.count("tusker"), 1)
        self.assertTrue(stt_names_prompt(REGISTRY, {}).endswith("White Tusker."))

    def test_the_company_hotwords_are_not_repeated_when_already_configured(self):
        _, hot = stt_vocabulary(REGISTRY, {"stt_hotwords": "tusker, white tusker"})
        self.assertEqual([w.strip() for w in hot.split(",")], ["tusker", "white tusker"])


class UnfinishedSentenceTests(unittest.TestCase):
    """The end-of-speech detector (speech/endpointing.py) ended the utterance by its grace period: the sentence was never finished."""

    def test_an_unfinished_sentence_is_not_answered_by_guessing(self):
        a = _agent()
        a._pending = a._confirm = None
        asyncio.run(a._run_command("Can you tell me about the", unfinished=True))
        said = " ".join(a.said)
        self.assertIn("stopped mid-sentence", said)
        self.assertIn("repeat the whole request", said)
        self.assertEqual(a.calls, [])  # nothing sent to the CMS
        self.assertEqual(a._history, [])  # and not kept as conversation

    def test_when_whisper_is_also_unsure_the_mid_sentence_message_wins_and_nothing_runs(self):
        a = _agent()
        a._pending = a._confirm = None
        asyncio.run(a._run_command("Tell me about the", unsure=True, unfinished=True))
        said = " ".join(a.said)
        self.assertIn("stopped mid-sentence", said)
        self.assertNotIn("not sure I heard", said)
        self.assertEqual(a.calls, [])

    def test_an_exact_known_phrase_still_runs_even_if_it_was_judged_unfinished(self):
        a = _agent()
        a._pending = a._confirm = None
        asyncio.run(a._run_command("can you hear me", unfinished=True))
        self.assertNotIn("stopped mid-sentence", " ".join(a.said))

    def test_a_finished_sentence_is_unaffected(self):
        a = _agent()
        a._pending = a._confirm = None
        asyncio.run(a._run_command("can you hear me", unfinished=False))
        self.assertNotIn("stopped mid-sentence", " ".join(a.said))


class UnsureTests(unittest.TestCase):
    def test_an_unsure_command_runs_nothing_and_asks_to_repeat(self):
        a = _agent()
        a._pending = a._confirm = None
        asyncio.run(a._run_command("turn on the AC", unsure=True))
        said = " ".join(a.said)
        self.assertIn("not sure I heard that right", said)
        self.assertIn("repeat the command", said)
        self.assertEqual(a.calls, [])
        self.assertEqual(a._history, [])  # not kept as conversation

    def test_low_confidence_transcript_is_not_acted_on(self):
        t = Transcript("Hey Travis. Turn off tusker l3.", "en", 1.0, 1.0)
        t.avg_logprob = -0.51
        a = _agent(_stt=_FakeSTT(t), _min_logprob=-0.5)
        from tests.test_local_agent import _hear

        _hear(a)
        self.assertEqual(a.calls, [])
        self.assertIn("not sure I heard that right", " ".join(a.said))

    def test_a_confident_transcript_runs_as_before(self):
        t = Transcript("Hey Travis, turn on the edge.", "en", 1.0, 1.0)
        t.avg_logprob = -0.12
        a = _agent(_stt=_FakeSTT(t), _min_logprob=-0.5)
        from tests.test_local_agent import _hear

        _hear(a)
        self.assertEqual(a.calls, [("device_control", {"action": "lights_on", "target": "tusker edge"})])

    def test_the_check_can_be_switched_off(self):
        t = Transcript("Hey Travis, turn on the edge.", "en", 1.0, 1.0)
        t.avg_logprob = -2.0
        a = _agent(_stt=_FakeSTT(t), _min_logprob=0.0)
        from tests.test_local_agent import _hear

        _hear(a)
        self.assertEqual(len(a.calls), 1)


if __name__ == "__main__":
    unittest.main()
