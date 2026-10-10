"""The relevance gate on every request logged as "declined (off topic)" in logs/exchanges.jsonl (2026-10-05..08).

Needs the real local model, so it runs only with TRAVIS_LIVE_LLM=1 (Ollama on localhost, qwen3:8b); otherwise it is skipped.
The classification of each line (and why) is in docs/OFFTOPIC_REVIEW.md.
"""

import asyncio
import os
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from nlu.local_llm import OllamaChat  # noqa: E402
from nlu.relevance import RelevanceGate  # noqa: E402
from nlu.transcript_fixes import fix_company_name  # noqa: E402

# declined in the log and rightly so: not about the room, the company, the CMS or Travis (or too garbled to be anything)
CORRECTLY_DECLINED = [
    "Well, glad I had a good day", "I'm not talking", "Where did I put this? Sleep. Sleep what? What is sleep", "Who is the Prime Minister of India",
    "Each other still in the world right this much", "Tell me about your pistol", "Wow", "It will go 2 inches", "Tell me a joke", "Who is Prime Minister of India",
    "Tell me about the history of lighting design.", "Of the light", "on the lines", "Good to launch course", "I won", "can you do me a favor", "tun on easy",
]
# declined in the log, wrongly: now allowed on to the planner / model path (which acts, answers or asks)
WRONGLY_DECLINED = [
    "welcome to the stream", "tusker", "turn off the switch", "Unload floor and switch off tusker edge", "What is the whitest cove", "tell me about white, tusker",
    "How many lights are there", "history of White Tusker", "how did your company start",
]


@unittest.skipUnless(os.environ.get("TRAVIS_LIVE_LLM") == "1", "needs the local model: set TRAVIS_LIVE_LLM=1")
class LoggedExamples(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gate = RelevanceGate(OllamaChat(model="qwen3:8b", num_ctx=6144, temperature=0.3, max_tokens=200))

    def allowed(self, text):
        return asyncio.run(self.gate.review(fix_company_name(text), [])).allowed

    def test_correctly_declined_stay_declined(self):
        for t in CORRECTLY_DECLINED:
            with self.subTest(t=t):
                self.assertFalse(self.allowed(t))

    def test_wrongly_declined_now_pass(self):
        for t in WRONGLY_DECLINED:
            with self.subTest(t=t):
                self.assertTrue(self.allowed(t))


if __name__ == "__main__":
    unittest.main()
