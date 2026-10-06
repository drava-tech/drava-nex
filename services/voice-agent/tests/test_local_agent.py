"""TravisLocal's exchange flow with fake STT, tools, LLM and speech: which
utterances become commands, and which path (fast path / LLM) answers."""

import asyncio
import sys
import unittest
from pathlib import Path

AGENT_ROOT = Path(__file__).resolve().parent.parent
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from safety.action_guard import ActionGuard  # noqa: E402
from nlu.command_matcher import load_registry  # noqa: E402
from nlu.intent import IntentCheck, Verdict  # noqa: E402
from nlu.local_llm import ToolCall  # noqa: E402
from nlu.relevance import Review  # noqa: E402
from speech.stt import Transcript  # noqa: E402
from speech.vad import Endpointer  # noqa: E402
from agent.local import TravisLocal
from settings import COMMANDS_PATH  # noqa: E402

REGISTRY = load_registry(COMMANDS_PATH)


class _FakeWakeModel:
    label = "hey travis"


class _FakeUI:
    muted = False

    def write_log(self, text):
        pass

    def set_state(self, state):
        pass


class _FakeSTT:
    def __init__(self, transcript: Transcript):
        self._t = transcript

    def transcribe(self, pcm):
        return self._t


class _FakeLLM:
    model = "fake"

    def __init__(self, *rounds):
        self._rounds = list(rounds)
        self.requests = []

    async def stream(self, messages, tools):
        self.requests.append([dict(m) for m in messages])
        for event in self._rounds.pop(0):
            yield event


class _FakeGate:
    """Stands in for nlu.relevance.RelevanceGate: returns `review`, or lets
    the command through unchanged."""

    def __init__(self, review: Review | None = None):
        self._review = review
        self.seen: list[str] = []

    async def review(self, command, history=None, corrected=False):
        self.seen.append(command)
        return self._review or Review(True, command)


def _agent(heard: str = "", **state) -> TravisLocal:
    a = object.__new__(TravisLocal)
    a.ui = _FakeUI()
    a.elevenlabs = None
    a._wake_model = _FakeWakeModel()
    a._awake = True
    a._awake_until = 100.0
    a._exchange_active = False
    a._exchange_is_nudge = False
    a._reply_complete_at = None
    a._last_model_activity = 0.0
    a._nudge_state = "none"
    a._wake_transcript = ""
    a._wake_confirmed = False
    a._heard_command_speech = False
    a._timing = {}
    a._wake_stats = {"sent": 0, "drop_speaking": 0, "drop_tool": 0, "drop_full": 0}
    a._tool_active = 0
    a._registry = REGISTRY
    a._match_opts = {}
    a._command_lock = asyncio.Lock()
    a._history = []
    a._history_at = 0.0
    a._guard = ActionGuard(REGISTRY)
    a._light_names_fn = lambda: ["tusker edge", "tusker L1", "tusker L2"]
    a._utterance = ""
    a._xlog = None
    a._calls_log = []
    a._path = None
    a._first_say = None
    a._last_heard = {}
    a._system_prompt = "SYSTEM"
    a._llm_tools = []
    a._llm = _FakeLLM()
    a._gate = _FakeGate()
    a._intent = IntentCheck(None, enabled=False)
    a._off_topic_reply = "Sorry, only the room."
    a._partial_reply = "I can't help with the rest."
    a._endpointer = Endpointer(vad=object())
    a._ignore_before = 0.0
    a._stt = _FakeSTT(Transcript(heard, "en", 0.95, 0.95))
    a.said = []
    a.calls = []
    a.tool_ok = True

    async def say(text):
        a.said.append(text)

    async def finish():
        a._reply_complete_at = 1.0

    async def call_tool(name, args):
        a.calls.append((name, args))
        return a.tool_ok, "CMS: " + name

    a._say = say
    a._finish_reply = finish
    a._call_tool = call_tool
    for k, v in state.items():
        setattr(a, k, v)
    return a


def _hear(a: TravisLocal):
    asyncio.run(a._handle_utterance(b"\x00\x00" * 1600))


class UtteranceGateTests(unittest.TestCase):
    def test_wake_word_and_command_in_one_breath_runs_the_fast_path(self):
        a = _agent("Hey Travis, turn on the edge.")
        _hear(a)
        self.assertEqual(a.calls, [("device_control", {"action": "lights_on", "target": "tusker edge"})])
        self.assertEqual(a.said, ["CMS: device_control"])
        self.assertTrue(a._exchange_active)
        self.assertIsNotNone(a._reply_complete_at)

    def test_fast_path_confirmation_only_on_success(self):
        a = _agent("Hey Travis set the AC to 22")
        _hear(a)
        self.assertEqual(a.said, ["AC set to 22 degrees."])
        b = _agent("Hey Travis set the AC to 22", tool_ok=False)
        _hear(b)
        self.assertEqual(b.said, ["CMS: device_control"])

    def test_confidently_non_english_is_ignored_silently(self):
        a = _agent(_stt=_FakeSTT(Transcript("", "hi", 0.9, 0.02, rejected_language="hi")))
        _hear(a)
        self.assertEqual((a.calls, a.said), ([], []))
        self.assertFalse(a._exchange_active)
        self.assertTrue(a._awake)  # keep waiting for a real command

    def test_non_latin_script_is_ignored(self):
        a = _agent("ट्रैविस लाइट ऑन करो")
        _hear(a)
        self.assertEqual((a.calls, a.said), ([], []))

    def test_just_the_wake_word_waits_for_the_nudge(self):
        a = _agent("Hey Travis.")
        _hear(a)
        self.assertEqual(a.calls, [])
        self.assertTrue(a._wake_confirmed)
        self.assertFalse(a._heard_command_speech)
        self.assertTrue(a._awake)

    def test_words_without_travis_are_a_false_wake(self):
        a = _agent("turn on the lights")
        _hear(a)
        self.assertEqual(a.calls, [])
        self.assertFalse(a._awake)

    def test_command_after_a_bare_travis_needs_no_second_travis(self):
        a = _agent("lock the door", _wake_confirmed=True)
        _hear(a)
        self.assertEqual(a.calls, [("device_control", {"action": "lock"})])

    def test_answer_to_the_nudge_needs_no_travis(self):
        a = _agent("mute", _nudge_state="done")
        _hear(a)
        self.assertEqual(a.calls, [("device_control", {"action": "ac_command", "command": "mute"})])

    def test_whisper_noise_is_ignored(self):
        a = _agent(_stt=_FakeSTT(Transcript("", "en", 0.5, 0.5, no_speech=True)))
        _hear(a)
        self.assertEqual((a.calls, a.said), ([], []))


class RelevanceTests(unittest.TestCase):
    def test_off_topic_is_declined_without_calling_the_llm(self):
        llm = _FakeLLM()
        a = _agent("Hey Travis tell me a joke", _llm=llm, _gate=_FakeGate(Review(False, "", True)))
        _hear(a)
        self.assertEqual(a.said, ["Sorry, only the room."])
        self.assertEqual((llm.requests, a.calls), ([], []))
        # A declined turn isn't remembered, so "another one" can't ride on it.
        self.assertEqual(a._history, [])

    def test_a_known_part_runs_and_only_the_rest_is_judged(self):
        gate = _FakeGate(Review(False, "", True))
        a = _agent("Hey Travis unlock the door and tell me a joke", _gate=gate)
        _with_messages(a, {"unlock": "Door unlocked."})
        _hear(a)
        self.assertEqual(gate.seen, ["tell me a joke"])  # the gate never sees the part already done
        self.assertEqual(a.calls, [("device_control", {"action": "unlock"})])
        self.assertEqual(" ".join(a.said), "Door unlocked. Sorry, only the room.")

    def test_mixed_request_runs_only_the_in_scope_part(self):
        # nothing here is a known command, so the whole sentence is judged and trimmed
        llm = _FakeLLM([("tool_calls", [ToolCall("device_control", {"action": "lock"})])])
        gate = _FakeGate(Review(True, "secure the door", True))
        a = _agent("Hey Travis could you secure the door and tell me a joke", _llm=llm, _gate=gate)
        _with_messages(a, {"lock": "Door locked."})
        _hear(a)
        self.assertEqual(gate.seen, ["could you secure the door and tell me a joke"])
        # The model never sees the off-topic half.
        self.assertTrue(llm.requests[0][-1]["content"].endswith("secure the door"))
        self.assertNotIn("joke", llm.requests[0][-1]["content"])
        self.assertEqual("".join(a.said).strip(), "Door locked. I can't help with the rest.")

    def test_fast_path_commands_skip_the_gate(self):
        gate = _FakeGate(Review(False, "", True))
        a = _agent("Hey Travis lock the door", _gate=gate)
        _hear(a)
        self.assertEqual(gate.seen, [])
        self.assertEqual(a.calls, [("device_control", {"action": "lock"})])


def _with_messages(agent: TravisLocal, messages: dict, ok: bool = True):
    """Make the fake tool return a specific message per action (or per tool name)."""

    async def call_tool(name, args):
        agent.calls.append((name, args))
        return ok, messages.get(args.get("action"), messages.get(name, "Done."))

    agent._call_tool = call_tool


class LlmPathTests(unittest.TestCase):
    def test_unmatched_command_goes_to_the_llm_with_tools(self):
        # "put the AC at twenty two degrees" is a known command; "kill the lights" isn't:
        # the list does the first exactly, the model gets only the second.
        llm = _FakeLLM([("tool_calls", [ToolCall("device_control", {"action": "all_lights_off"})])])
        a = _agent("Hey Travis could you kill the lights and put the AC at twenty two degrees", _llm=llm)
        _with_messages(a, {"all_lights_off": "Turned off 3 lights."})
        _hear(a)
        self.assertEqual([c[1]["action"] for c in a.calls], ["ac_command", "all_lights_off"])
        self.assertEqual(" ".join(a.said), "AC set to 22 degrees. Turned off 3 lights.")
        self.assertEqual(len(llm.requests), 1)
        self.assertTrue(llm.requests[0][-1]["content"].endswith("could you kill the lights"))
        self.assertNotIn("22", llm.requests[0][-1]["content"].split(")")[-1])  # the model never sees the part already done
        self.assertEqual(a._history[-1]["content"], "AC set to 22 degrees. Turned off 3 lights.")

    def test_system_prompt_stays_first_and_unchanged(self):
        llm = _FakeLLM([("text", "Hello.")])
        a = _agent("Hey Travis what's the capital of France", _llm=llm)
        _hear(a)
        first = llm.requests[0]
        self.assertEqual(first[0], {"role": "system", "content": "SYSTEM"})
        self.assertTrue(first[-1]["content"].endswith("what's the capital of France"))


class NeverConfirmWhatDidNotHappenTests(unittest.TestCase):
    def run_llm(self, rounds, tool_messages=None, tool_ok=True, heard="Hey Travis do the thing now"):
        llm = _FakeLLM(*rounds)
        a = _agent(heard, _llm=llm)
        _with_messages(a, tool_messages or {}, tool_ok)
        _hear(a)
        return a, llm

    def test_a_claim_with_no_tool_behind_it_is_replaced(self):
        a, _ = self.run_llm([[("text", "Turned off "), ("text", "3 lights.")]])
        self.assertEqual(a.calls, [])
        self.assertNotIn("Turned off", " ".join(a.said))
        self.assertIn("I haven't changed anything yet", " ".join(a.said))

    def test_a_promise_with_no_tool_behind_it_is_replaced(self):
        a, _ = self.run_llm([[("text", "I'll increase the brightness.")]])
        self.assertIn("I haven't changed anything yet", " ".join(a.said))

    def test_a_failed_tool_is_reported_not_the_models_optimism(self):
        a, _ = self.run_llm(
            [[("text", "Done, the door is unlocked!"), ("tool_calls", [ToolCall("device_control", {"action": "unlock"})])]],
            {"unlock": "The device didn't respond."}, tool_ok=False,
            heard="Hey Travis I need that door unlocked",
        )
        self.assertEqual(" ".join(a.said), "The device didn't respond.")

    def test_text_the_model_writes_before_a_tool_is_never_spoken(self):
        a, _ = self.run_llm(
            [[("text", "Sure, doing that now! "), ("tool_calls", [ToolCall("device_control", {"action": "lock"})])]],
            {"lock": "Door locked."},
            heard="Hey Travis please secure the door",
        )
        self.assertEqual(" ".join(a.said), "Door locked.")

    def test_a_failure_among_successes_is_not_hidden(self):
        async def call_tool(name, args):
            a.calls.append((name, args))
            return (False, 'I couldn\'t find exactly one device matching "tusker L9". Which one did you mean? The devices are: x. Only offer these.') if str(args.get("target")).lower() == "tusker l9" else (True, "Door locked.")

        llm = _FakeLLM()
        a = _agent("Hey Travis lock the door and turn on tusker L9 light", _llm=llm)
        a._call_tool = call_tool
        _hear(a)
        said = " ".join(a.said)
        self.assertIn("Door locked.", said)
        self.assertIn("tusker L9", said)
        self.assertNotIn("Only offer these", said)
        self.assertTrue(said.endswith("Say Hey Travis, then your answer."))

    def test_the_same_call_twice_runs_once(self):
        a, _ = self.run_llm(
            [[("tool_calls", [ToolCall("device_control", {"action": "lock"}), ToolCall("device_control", {"action": "lock"})])]],
            {"lock": "Door locked."},
            heard="Hey Travis please secure the door",
        )
        self.assertEqual(len(a.calls), 1)
        self.assertEqual(" ".join(a.said), "Door locked.")

    def test_a_question_says_how_to_answer_it(self):
        a, _ = self.run_llm([[("text", "Which light do you mean?")]])
        self.assertEqual(" ".join(a.said), "Which light do you mean? Say Hey Travis, then your answer.")

    def test_results_that_need_interpreting_go_back_to_the_model(self):
        a, llm = self.run_llm(
            [[("tool_calls", [ToolCall("knowledge_search", {"query": "opening hours"})])], [("text", "We open at nine.")]],
            {"knowledge_search": "Open 9 to 5."},
        )
        self.assertEqual(len(llm.requests), 2)
        self.assertEqual(" ".join(a.said), "We open at nine.")

    def test_a_model_claim_after_a_knowledge_lookup_is_still_blocked(self):
        a, _ = self.run_llm(
            [[("tool_calls", [ToolCall("knowledge_search", {"query": "x"})])], [("text", "I've turned on the lights for you.")]],
            {"knowledge_search": "nothing"},
        )
        self.assertIn("I haven't changed anything yet", " ".join(a.said))

    def test_a_claim_next_to_a_real_action_says_what_really_happened(self):
        a, _ = self.run_llm(
            [[("tool_calls", [ToolCall("device_control", {"action": "lock"}), ToolCall("knowledge_search", {"query": "x"})])],
             [("text", "I locked the door and turned off the AC.")]],
            {"lock": "Door locked.", "knowledge_search": "nothing"},
            heard="Hey Travis would you secure the door and look something up",
        )
        self.assertEqual(" ".join(a.said), "Door locked.")

    def test_digits_keep_their_spaces(self):
        a, _ = self.run_llm([[("text", "There are "), ("text", "22"), ("text", " screens here.")]])
        self.assertEqual(" ".join(a.said), "There are 22 screens here.")

    def test_status_reads_are_spoken_as_the_cms_said_them(self):
        a, llm = self.run_llm(
            [[("tool_calls", [ToolCall("device_control", {"action": "status", "target": "ac"})])]],
            {"status": "Experience Center AC is on set to 23°C."},
            heard="Hey Travis how warm is the AC set to",
        )
        self.assertEqual(" ".join(a.said), "Experience Center AC is on set to 23°C.")
        self.assertEqual(len(llm.requests), 1)

    def test_the_fast_path_cleans_a_refusal_before_speaking_it(self):
        a = _agent("Hey Travis turn on tusker edge")
        _with_messages(a, {"lights_on": "I couldn\'t find exactly one device matching \"x\". Which one did you mean? The devices are: a, b. Only offer these."}, ok=False)
        _hear(a)
        said = " ".join(a.said)
        self.assertNotIn("Only offer these", said)
        self.assertTrue(said.endswith("Say Hey Travis, then your answer."))


class MultiActionExecutionTests(unittest.TestCase):
    def go(self, heard, ok_for=None, messages=None):
        a = _agent(heard)
        sent = []

        async def call_tool(name, args):
            sent.append((name, args))
            good = (ok_for is None) or ok_for(args)
            return good, (messages or {}).get(args.get("action"), "Done." if good else "That failed.")

        a._call_tool = call_tool
        _hear(a)
        return a, sent

    def test_every_part_runs_in_the_order_spoken_without_the_model(self):
        llm = _FakeLLM()
        a = _agent("Hey Travis set the AC to 24 and turn on tusker edge and lock the door", _llm=llm)
        sent = []

        async def call_tool(name, args):
            sent.append(args["action"])
            return True, {"lights_on": "tusker edge is on.", "lock": "Door locked."}.get(args["action"], "ok")

        a._call_tool = call_tool
        _hear(a)
        self.assertEqual(sent, ["ac_command", "lights_on", "lock"])
        self.assertEqual(llm.requests, [])  # exact, and no model involved
        self.assertEqual(" ".join(a.said), "AC set to 24 degrees. tusker edge is on. Door locked.")

    def test_one_part_failing_does_not_stop_or_hide_the_others(self):
        a, sent = self.go("Hey Travis unlock the door and turn on tusker L9 light and set the AC to 22",
                          ok_for=lambda args: args.get("target") != "tusker L9",
                          messages={"lights_on": "I couldn't find exactly one device matching \"tusker L9\". Which one did you mean?"})
        self.assertEqual([c[1]["action"] for c in sent], ["unlock", "lights_on", "ac_command"])
        said = " ".join(a.said)
        self.assertIn("AC set to 22 degrees.", said)
        self.assertIn("tusker L9", said)

    def test_an_out_of_range_part_is_asked_about_and_the_rest_still_runs(self):
        # the lock is a known command and runs; 5 degrees isn't one the list accepts, so only
        # that part reaches the model...
        llm = _FakeLLM(
            [("tool_calls", [ToolCall("device_control", {"action": "ac_command", "command": "set_temp", "params": {"temp": 5}})])],
            [("text", "")],
        )
        a = _agent("Hey Travis lock the door and set the AC to 5 degrees", _llm=llm)
        _with_messages(a, {"lock": "Door locked."})
        _hear(a)
        # ...and the guard keeps the bad value away from the CMS
        self.assertEqual([c[1]["action"] for c in a.calls], ["lock"])
        said = " ".join(a.said)
        self.assertIn("Door locked.", said)
        self.assertIn("16 to 30", said)
        self.assertNotIn("set to 5", said)

    def test_a_clause_the_list_does_not_know_sends_the_whole_sentence_to_the_model(self):
        llm = _FakeLLM([("text", "I can only help with the room.")])
        a = _agent("Hey Travis set the AC to 24 and sing me a song", _llm=llm)
        _hear(a)
        self.assertEqual(len(a.calls), 1)  # the AC part ran
        self.assertEqual(len(llm.requests), 1)  # only "sing me a song" went to the model


class AsksInsteadOfGuessingTests(unittest.TestCase):
    def test_a_model_guess_is_held_back_and_the_model_gets_one_retry(self):
        # round 1: guesses a device nobody named; round 2: asks instead
        llm = _FakeLLM(
            [("tool_calls", [ToolCall("device_control", {"action": "lights_set", "target": "the room", "brightness": 60})])],
            [("text", "Which light would you like brighter?")],
        )
        a = _agent("Hey Travis set the room to sixty percent", _llm=llm)
        _with_messages(a, {})
        _hear(a)
        self.assertEqual(a.calls, [])  # nothing reached the CMS
        self.assertEqual(len(llm.requests), 2)
        self.assertTrue(any("NOT SENT" in m["content"] for m in llm.requests[1] if m["role"] == "tool"))
        self.assertIn("Which light", " ".join(a.said))

    def test_a_guess_that_is_not_corrected_becomes_the_guards_question(self):
        llm = _FakeLLM(
            [("tool_calls", [ToolCall("device_control", {"action": "lights_set", "target": "the room", "brightness": 60})])],
            [("tool_calls", [ToolCall("device_control", {"action": "lights_set", "target": "the room", "brightness": 60})])],
        )
        a = _agent("Hey Travis set the room to sixty percent", _llm=llm)
        _with_messages(a, {})
        _hear(a)
        self.assertEqual(a.calls, [])
        said = " ".join(a.said)
        self.assertIn("Which light do you mean", said)  # asks, and names the real choices
        self.assertIn("tusker edge", said)
        self.assertIn("Say Hey Travis, then your answer.", said)

    def test_the_model_correcting_itself_runs_only_the_good_call(self):
        llm = _FakeLLM(
            [("tool_calls", [ToolCall("device_control", {"action": "lights_set", "target": "tusker L1", "brightness": 60})])],
            [("tool_calls", [ToolCall("device_control", {"action": "lights_set", "target": "tusker edge", "brightness": 80})])],
        )
        a = _agent("Hey Travis make tusker edge much brighter at 80 percent", _llm=llm)
        _with_messages(a, {"lights_set": "tusker edge is on at 80%."})
        _hear(a)
        self.assertEqual([c[1]["target"] for c in a.calls], ["tusker edge"])
        self.assertEqual(" ".join(a.said), "tusker edge is on at 80%.")

    def test_a_pronoun_with_nothing_before_it_asks(self):
        guess = ("tool_calls", [ToolCall("device_control", {"action": "lights_off", "target": "tusker edge"})])
        llm = _FakeLLM([guess], [guess])
        a = _agent("Hey Travis turn it off", _llm=llm)
        _with_messages(a, {})
        _hear(a)
        self.assertEqual(a.calls, [])
        self.assertIn("Which light", " ".join(a.said))

    def test_it_means_what_was_just_used(self):
        a = _agent("Hey Travis turn on tusker edge")
        _with_messages(a, {"lights_on": "tusker edge is on at 100%."})
        _hear(a)
        llm = _FakeLLM([("tool_calls", [ToolCall("device_control", {"action": "lights_set", "target": "tusker edge", "brightness": 80})])])
        a._llm = llm
        a._stt = _FakeSTT(Transcript("Hey Travis make it eighty percent", "en", 0.95, 0.95))
        a._wake_confirmed = False
        a._wake_transcript = ""
        a.said.clear()
        _with_messages(a, {"lights_set": "tusker edge is on at 80%."})
        _hear(a)
        self.assertEqual(a.calls[-1][1]["target"], "tusker edge")
        self.assertIn("Last used: lights = tusker edge", llm.requests[0][-1]["content"])

    def test_a_self_correction_with_a_whole_command_uses_the_last_version(self):
        a = _agent("Hey Travis turn on tusker L1, no wait, turn off tusker L2")
        _with_messages(a, {})
        _hear(a)
        self.assertEqual([(c[1]["action"], c[1]["target"]) for c in a.calls], [("lights_off", "tusker L2")])

    def test_a_self_corrected_value_goes_to_the_model_which_is_held_to_what_was_said(self):
        llm = _FakeLLM([("tool_calls", [ToolCall("device_control", {"action": "ac_command", "command": "set_temp", "params": {"temp": 22}})])])
        a = _agent("Hey Travis set the AC to 24 no wait 22", _llm=llm)
        _with_messages(a, {})
        _hear(a)
        self.assertEqual(len(llm.requests), 1)
        self.assertEqual(a.calls[0][1]["params"]["temp"], 22)
        self.assertEqual(" ".join(a.said), "AC set to 22 degrees.")

    def test_never_mind_changes_nothing(self):
        a = _agent("Hey Travis never mind")
        _with_messages(a, {})
        _hear(a)
        self.assertEqual(a.calls, [])
        self.assertEqual(" ".join(a.said), "Okay, nothing changed.")

    def test_a_closing_stop_cancels_the_command_before_it(self):
        a = _agent("Hey Travis turn on, tusker edge. Stop.")
        _with_messages(a, {})
        _hear(a)
        self.assertEqual(a.calls, [])
        self.assertEqual(" ".join(a.said), "Okay, nothing changed.")

    def test_a_request_the_model_reads_as_taken_back_runs_nothing(self):
        class Withdrawn:
            async def check(self, command):
                return Verdict("cancel", "")

        a = _agent("Hey Travis set the AC to 22, actually don't")
        a._intent = Withdrawn()
        _with_messages(a, {})
        _hear(a)
        self.assertEqual(a.calls, [])
        self.assertEqual(" ".join(a.said), "Okay, nothing changed.")

    def test_a_partly_taken_back_request_runs_only_the_part_still_wanted(self):
        class Partly:
            async def check(self, command):
                return Verdict("keep", "turn on tusker L1")

        a = _agent("Hey Travis turn on tusker L1 and also tusker L2, oh no, not that one")
        a._intent = Partly()
        _with_messages(a, {})
        _hear(a)
        self.assertEqual([(c[1]["action"], c[1]["target"]) for c in a.calls], [("lights_on", "tusker L1")])

    def test_the_intent_verdict_is_read_defensively(self):
        from nlu.intent import parse_verdict

        self.assertEqual(parse_verdict("CANCEL", "x y").kind, "cancel")
        self.assertEqual(parse_verdict("GO", "x y").kind, "go")
        self.assertEqual(parse_verdict("", "x y").kind, "go")
        self.assertEqual(parse_verdict("something odd", "x y").kind, "go")
        kept = parse_verdict("KEEP: turn on the lights", "turn on the lights and the AC, skip the AC")
        self.assertEqual((kept.kind, kept.command), ("keep", "turn on the lights"))
        # a rewrite that brings in words the speaker never said is not trusted
        self.assertEqual(parse_verdict("KEEP: turn on the heater", "turn on the lights, oh no").kind, "go")

    def test_a_bare_stop_is_still_the_cms_stop(self):
        from nlu import repairs

        self.assertFalse(repairs.ends_with_stop("Stop."))
        self.assertFalse(repairs.ends_with_stop("stop the video"))
        self.assertTrue(repairs.ends_with_stop("Turn on, tusker edge. Stop."))
        self.assertTrue(repairs.ends_with_stop("turn off the lights, stop"))

    def test_content_is_pushed_as_whichever_kind_it_is(self):
        a = _agent("Hey Travis show the company presentation on tusker 86")
        attempts = []

        async def call_tool(name, args):
            attempts.append(args["action"])
            if args["action"] == "assign_media":
                return True, 'Pushed "Company Presentation" to tusker 86.'
            return False, 'I couldn\'t find exactly one experience matching "company presentation". Which one did you mean? The experiences are: Welcome Experience.'

        a._call_tool = call_tool
        import actions.cms_client as cc

        cc.list_experiences = lambda: [{"title": "Welcome Experience"}]
        cc.list_media = lambda: [{"name": "Company Presentation"}]
        _hear(a)
        self.assertEqual(attempts, ["assign_media"])  # picked the right list first
        self.assertEqual(" ".join(a.said), 'Pushed "Company Presentation" to tusker 86.')


if __name__ == "__main__":
    unittest.main()
