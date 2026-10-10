"""Phase 6: the conversation test set. Cases for FAQ, small talk, room state, knowledge, follow-ups, the portfolio offer, declines and
command look-alikes (cases in conversation_cases.py), run through the production TravisLocal against the mock CMS.

Separate from the device-command bench (cases.py / judge.py / runner_text.py) on purpose: those have a fixed baseline (383/388) and a
single-utterance judge. Here a case is one or more TURNS in one conversation, and a turn is judged on the route taken, the FAQ entry that
answered, the CMS calls made, and the words said.

Real: the matcher (nomic-embed-text embeddings), retrieval (rag/), Qwen3-8B (planner, relevance gate, rewrite, knowledge answer), the reply
guards. Mock: the CMS. Never called: ElevenLabs (the speech method is captured; the streamer's network methods are replaced by tripwires that
fail the run), the microphone and Whisper.

    python -m bench.voice_bench conversation [--group faq --group portfolio] [--id room.] [--repeats 3] [--out DIR]

FAQ and small-talk entries are loaded as drafts too (TRAVIS_CANNED_STATUSES=draft,approved), so those cases are tagged "depends on approval":
re-run after the entries are reviewed.
"""

from __future__ import annotations

import json
import os
import re
import statistics
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from unittest import mock as umock

from . import canon, judge
from .agent import BenchAgent, bench_env
from .mock_cms import MockCms
from .names import DEVICES, EXPERIENCES, MEDIA, SCREENS, Fixtures
from .runner_text import PRESETS

ROOT = Path(__file__).resolve().parents[2]

# ── the case types ───────────────────────────────────────────────────────


@dataclass
class T:
    """One thing the visitor says, and what must follow."""
    say: str
    path: tuple[str, ...] = ()  # the route (agent._path) must start with one of these
    entry: str | None = None  # the FAQ / small-talk entry that must answer
    not_entry: tuple[str, ...] = ()  # entries that must NOT answer
    not_canned: bool = False  # no written-down answer at all
    holdout: bool = False  # the sentence itself is taken out of the index for this turn (it is a written variant): the hardest case, nothing identical to match
    miss_ok: bool = False  # with `entry`: passing on to the normal route is acceptable (a wrong entry never is)
    cms: str = "any"  # none | noact | read | do | any
    do: list | None = None  # actions that must happen (cms == "do")
    any_do: list | None = None  # or one of these alternatives
    allow: list = field(default_factory=list)  # actions tolerated, not required
    ask_ok: bool = False  # for "do": asking instead of acting is fine
    reply_any: tuple[str, ...] = ()
    reply_all: tuple[str, ...] = ()
    reply_none: tuple[str, ...] = ()
    exact: bool = True  # with a hit: the reply is the entry's text exactly
    decline: bool = False  # a polite refusal, nothing engaged with
    admits_failure: bool = False
    contact_ok: bool = False  # the contact line may be in the reply
    differs_from_previous: bool = False
    setup: str | None = None  # preset or fixture name
    inject: dict | None = None
    age_before: float = 0.0
    note: str = ""


@dataclass
class C:
    id: str
    group: str
    turns: list[T]
    known_gap: str = ""  # a gap already documented (docs/CONVERSATION_STATUS.md, PHASE3_ROOM_STATE_CASES.md): counted separately
    note: str = ""

    @property
    def depends_on_approval(self) -> bool:
        return any(t.entry or t.not_entry or t.not_canned or any(p.startswith(("faq", "small talk")) for p in t.path) for t in self.turns)


def one(cid: str, group: str, say: str, known_gap: str = "", **kw) -> C:
    return C(cid, group, [T(say, **kw)], known_gap=known_gap)


# ── fixtures beyond the device bench's presets ───────────────────────────


def _portfolio_playing(fx: Fixtures):
    fx.screens["main-screen"].update(experienceName="White Tusker Portfolio")


def _all_on(fx: Fixtures):
    for d in ("dev-edge", "dev-l1", "dev-l2"):
        fx.devices[d].update(on=True, brightness=100)


FIXTURES = {**PRESETS, "portfolio_playing": _portfolio_playing, "all_on": _all_on, "no_portfolio": lambda fx: None, "all_off": lambda fx: None}

# ── judging ──────────────────────────────────────────────────────────────

_PROMISE = re.compile(r"\b(i'?ll check|i will check|let me (?:check|find|look|see)|one moment|hold on|give me a (?:second|moment)|i'?ll find|i'?ll look)\b", re.I)
_CONTACT = re.compile(r"@|\bdot com\b|\bwww\b|https?:|\bthewhitetusker\b|\bhello at\b", re.I)
_DIGITS = re.compile(r"\d+")


def _knowledge_numbers() -> set[str]:
    nums: set[str] = set()
    for p in (ROOT / "knowledge").glob("*.md"):
        nums |= set(_DIGITS.findall(p.read_text(encoding="utf-8")))
    for d in DEVICES:
        nums |= set(_DIGITS.findall(d["name"]))
    for s in SCREENS:
        nums |= set(_DIGITS.findall(s["label"]))
    for e in EXPERIENCES:
        nums |= set(_DIGITS.findall(e["title"]))
    for m in MEDIA:
        nums |= set(_DIGITS.findall(m["name"]))
    return nums


KB_NUMBERS = _knowledge_numbers()


def llm_touched(agent, trace) -> bool:
    return bool(trace.llm_start or trace.gate or trace.plan or agent._timing.get("llm_first_token") or (agent._path or "") in ("knowledge", "planner"))


def judge_turn(case: C, turn: T, agent, trace, calls: list[dict], mock, prior_replies: list[str], el_calls: int) -> dict:
    from agent.vocabulary import speakable

    reply = trace.reply
    path = agent._path or ""
    canned_log = (agent._plan_log or {}).get("canned") if isinstance(agent._plan_log, dict) else None
    entry_id = canned_log["entry"] if canned_log else None
    posts = [c for c in calls if c["method"] == "POST"]
    ok_posts = [c for c in posts if c.get("status") and c["status"] < 300]
    reads = [c for c in calls if canon.is_read(c)]
    actual = [a for c in ok_posts for a in canon.canon_call(c)]
    failures: list[str] = []
    outcome = None

    if trace.error:
        failures.append("crashed")
    if el_calls:
        failures.append("elevenlabs_called")
    if not reply:
        failures.append("no_reply")

    # which route answered
    if turn.path and not any(path.startswith(p) for p in turn.path):
        failures.append(f"wrong_path:{path or 'none'}")
    if turn.entry:
        if entry_id == turn.entry:
            outcome = "hit"
        elif entry_id:
            outcome = "wrong"
            failures.append(f"wrong_entry:{entry_id}")
        else:
            outcome = "miss"
            if not turn.miss_ok:
                failures.append("not_matched")
    if turn.not_canned and entry_id:
        failures.append(f"answered_from_faq:{entry_id}")
    if entry_id and entry_id in turn.not_entry:
        failures.append(f"answered_by_wrong_entry:{entry_id}")

    # a written-down answer is the file's text, word for word
    if entry_id and agent._canned_matcher is not None and turn.exact:
        ent = next((e for e in agent._canned_matcher.entries if e.id == entry_id), None)
        if ent is not None:
            if not any(reply.startswith(speakable(a).strip()) for a in ent.answers):
                failures.append("reply_not_the_written_text")
            if len(reply.split()) > 70:
                failures.append("canned_reply_too_long")

    # the CMS
    if turn.cms == "none" and calls:
        failures.append("cms_called")
    elif turn.cms == "noact" and posts:
        failures.append("actuated")
    elif turn.cms == "read" and (posts or not reads):
        failures.append("actuated" if posts else "no_read")
    elif turn.cms == "do":
        alts = turn.any_do or [turn.do or []]
        match, _chosen = canon.best_compare(alts, actual)
        if len(ok_posts) != len(posts):
            failures.append("cms_rejected_call")
        asked = turn.ask_ok and not actual and judge.is_clarification(reply)
        if not asked:
            if match.missing:
                failures.append("missing_action")
            extras = [a for a in match.extra if not any(canon._matches(e, a) for e in turn.allow)]
            if extras:
                failures.append("extra_action")
            if match.duplicates:
                failures.append("duplicate_action")
    if turn.allow and turn.cms in ("none", "noact", "read", "any"):
        pass

    # the words
    if turn.reply_any and not judge.has_any(reply, list(turn.reply_any)):
        failures.append("reply_missing_expected")
    for needle in turn.reply_all:
        if not judge.has_any(reply, [needle]):
            failures.append(f"reply_missing:{needle}")
    if turn.reply_none and judge.has_any(reply, list(turn.reply_none)):
        failures.append("reply_has_forbidden")
    if turn.decline:
        if calls:
            failures.append("cms_called_for_off_topic")
        if not judge.is_decline(reply) and not path.startswith("declined"):
            failures.append("not_declined")
    if turn.admits_failure and not judge.admits_failure(reply):
        failures.append("failure_not_reported")
    if turn.differs_from_previous and prior_replies and reply == prior_replies[-1]:
        failures.append("same_reply_twice")

    # every turn
    if _PROMISE.search(reply.replace("’", "'")):
        failures.append("promise_without_answer")
    if re.search(r"\bThe White Tusker\b", reply):  # as the company's name; a lowercase "the White Tusker portfolio" is plain grammar
        failures.append("said_the_white_tusker")
    ent_email = False
    if entry_id and agent._canned_matcher is not None:
        ent = next((e for e in agent._canned_matcher.entries if e.id == entry_id), None)
        ent_email = bool(ent and ent.add_email_line)
    kb = (agent._plan_log or {}).get("knowledge") if isinstance(agent._plan_log, dict) else None
    first_overview = bool(kb) and kb.get("topic") == "company" and not any(_CONTACT.search(r) for r in prior_replies)  # by design: the first company answer ends with the contact line
    if _CONTACT.search(reply) and not (turn.contact_ok or ent_email or first_overview):
        failures.append("contact_detail_unasked")
    if not entry_id and "?" not in reply:  # (a question may state its own range, "from 0 to 100 percent")
        allowed = set(_DIGITS.findall(turn.say)) | KB_NUMBERS | {n for r in prior_replies for n in _DIGITS.findall(r)}
        allowed |= set(_DIGITS.findall(json.dumps({"devices": mock.fixtures.devices, "screens": mock.fixtures.screens})))
        invented = [n for n in _DIGITS.findall(reply) if n not in allowed]
        if invented:
            failures.append(f"invented_number:{','.join(invented)}")
    if turn.cms in ("none", "noact") and not ok_posts and not reads and judge.claims_action(reply):
        failures.append("claimed_action_without_acting")
    if judge.glued_numbers(reply):
        failures.append("glued_number")

    failures = list(dict.fromkeys(failures))
    total_ms = (trace.t_end - trace.t0) * 1000 if trace.t_end else None
    return {
        "case": case.id, "group": case.group, "say": turn.say, "reply": reply, "route": path or "none", "entry": entry_id,
        "canned_score": canned_log.get("score") if canned_log else None, "outcome": outcome,
        "failures": failures, "success": not failures, "latency_ms": round(total_ms) if total_ms is not None else None,
        "first_text_ms": round((trace.said[0][0] - trace.t0) * 1000) if trace.said else None,
        "llm": llm_touched(agent, trace), "calls": [f"{c['method']} {c['path']}" for c in calls], "actions": actual,
        "knowledge": (agent._plan_log or {}).get("knowledge") if isinstance(agent._plan_log, dict) else None,
        "depends_on_approval": case.depends_on_approval, "known_gap": case.known_gap, "note": turn.note,
    }


# ── running ──────────────────────────────────────────────────────────────


def _reset_conversation(agent):
    agent.reset_context()
    agent._kb_used, agent._kb_company_said, agent._kb_ok = frozenset(), False, False
    agent._company_answers, agent._portfolio_offered, agent._portfolio_declined = 0, False, False
    agent._portfolio_skip_until, agent._kb_last_topic, agent._confirm = 0.0, "company", None
    agent._canned_last, agent._jokes_used = {}, set()
    agent._path, agent._plan_log = None, None


def _hold_out(matcher, sentence: str):
    """Remove the index rows whose variant is `sentence` (any entry); returns the function that puts them back."""
    import numpy as np

    from nlu.canned import normalise

    want = normalise(sentence)
    keep = [i for i, (_ei, _v, nv) in enumerate(matcher._rows) if nv != want]
    rows, matrix = matcher._rows, matcher._matrix
    matcher._rows, matcher._matrix = [rows[i] for i in keep], np.asarray(matrix)[keep]

    def restore():
        matcher._rows, matcher._matrix = rows, matrix
    return restore


class _Tripwire:
    def __init__(self):
        self.count = 0

    async def __call__(self, *a, **k):
        self.count += 1
        raise RuntimeError("ElevenLabs must not be called by the conversation tests")


async def run_conversation(selected: list[C], out_dir: Path, repeats: int = 3, quiet: bool = False) -> list[dict]:
    os.environ.setdefault("TRAVIS_CANNED_STATUSES", "draft,approved")
    out_dir.mkdir(parents=True, exist_ok=True)
    from actions import cms_client
    from nlu.relevance import gate_messages
    from speech.elevenlabs_stream import ElevenLabsStreamer

    mock = MockCms().start()
    sink = (out_dir / "conversation_results.jsonl").open("w", encoding="utf-8")
    results: list[dict] = []
    trip = _Tripwire()
    saved_experiences = list(EXPERIENCES)
    with bench_env(mock), umock.patch.object(ElevenLabsStreamer, "ensure_session", trip), umock.patch.object(ElevenLabsStreamer, "send_text", trip), \
            umock.patch.object(ElevenLabsStreamer, "prewarm", trip), umock.patch.object(ElevenLabsStreamer, "flush", trip):
        agent = BenchAgent()
        print("[conv] warming the LLM...", flush=True)
        await agent._llm.warm([{"role": "system", "content": agent._system_prompt}], agent._llm_tools)
        await agent._llm.complete(gate_messages("hi", []), 2)
        await agent._try_canned("hello")  # builds the written-answer index once (embeds every variant)
        print(f"[conv] ready. {len(selected)} cases, up to {repeats} runs of the ones that use the model. "
              f"Written answers: {len(agent._canned_matcher.entries) if agent._canned_matcher else 0}.", flush=True)

        async def play(case: C, rep: int) -> list[dict]:
            rows, prior = [], []
            _reset_conversation(agent)
            fx = Fixtures.fresh()
            if case.turns[0].setup:
                FIXTURES[case.turns[0].setup](fx)
            if any(t.setup == "no_portfolio" for t in case.turns):
                EXPERIENCES[:] = [e for e in saved_experiences if "portfolio" not in e["title"].lower()]
            mock.reset(fault=None, fixtures=fx)
            cms_client._name_cache.clear()
            for i, turn in enumerate(case.turns):
                if turn.setup and i > 0 and turn.setup in FIXTURES and turn.setup != "no_portfolio":
                    FIXTURES[turn.setup](mock.fixtures)
                down = bool(turn.inject and turn.inject.get("mode") == "down")
                mock.fault = turn.inject if not down else None
                if down:
                    mock.stop()
                if turn.age_before:
                    agent.age_context(turn.age_before)
                mark = mock.snapshot()
                before = trip.count
                restore = _hold_out(agent._canned_matcher, turn.say) if turn.holdout else None
                try:
                    trace = await agent.run(turn.say)
                finally:
                    if restore:
                        restore()
                calls = mock.calls_since(mark)
                row = judge_turn(case, turn, agent, trace, calls, mock, prior, trip.count - before)
                row.update(repeat=rep, turn=i + 1, turns=len(case.turns))
                rows.append(row)
                prior.append(row["reply"])
                if down:
                    mock.start()
            EXPERIENCES[:] = saved_experiences
            return rows

        for case in selected:
            rep, batches = 0, []
            while True:
                rows = await play(case, rep)
                batches.append(rows)
                rep += 1
                model_dependent = any(r["llm"] for b in batches for r in b)
                if not model_dependent or rep >= repeats:
                    break
            for rows in batches:
                for r in rows:
                    r["model_dependent"] = model_dependent
                    results.append(r)
                    sink.write(json.dumps(r, ensure_ascii=False, default=str) + "\n")
                    sink.flush()
                    if not quiet:
                        flag = "PASS" if r["success"] else "FAIL"
                        extra = "" if r["success"] else "  <- " + ",".join(r["failures"])
                        print(f"[{flag}] {r['case']:<34} r{r['repeat'] + 1} {r['latency_ms'] or 0:>6}ms {r['route'][:22]:<22} {r['say'][:44]!r}{extra}", flush=True)
        if trip.count:
            print(f"[conv] !!! ElevenLabs was called {trip.count} times", flush=True)
    sink.close()
    mock.stop()
    results.append({"_meta": True, "elevenlabs_calls": trip.count})
    (out_dir / "conversation_meta.json").write_text(json.dumps({"elevenlabs_calls": trip.count, "repeats": repeats}), encoding="utf-8")
    return results


# ── report ───────────────────────────────────────────────────────────────

GROUP_ORDER = ["faq", "smalltalk", "room_state", "knowledge", "followup", "portfolio", "decline", "lookalike"]
GROUP_TITLES = {"faq": "FAQ", "smalltalk": "Small talk", "room_state": "Room state", "knowledge": "Knowledge", "followup": "Follow-ups",
                "portfolio": "Portfolio offer", "decline": "Declines", "lookalike": "Command look-alikes"}


def _pct(a: int, b: int) -> str:
    return "-" if not b else f"{100 * a / b:.0f}% ({a}/{b})"


def _case_status(rows_by_rep: dict[int, list[dict]]) -> tuple[bool, int, int]:
    """(all runs pass, runs passed, runs)"""
    ok = [all(r["success"] for r in rows) for rows in rows_by_rep.values()]
    return all(ok), sum(ok), len(ok)


def build_report(results: list[dict], out_path: Path, repeats: int, meta: dict) -> str:
    rows = [r for r in results if not r.get("_meta")]
    by_case: dict[str, dict[int, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for r in rows:
        by_case[r["case"]][r["repeat"]].append(r)
    info = {cid: next(iter(reps.values()))[0] for cid, reps in by_case.items()}
    status = {cid: _case_status(reps) for cid, reps in by_case.items()}
    L: list[str] = []
    add = L.append
    add("# Conversation test results (Phase 6)")
    add("")
    add(f"Run {time.strftime('%Y-%m-%d %H:%M')}. Real TravisLocal, real matcher/embeddings, real retrieval, real Qwen3-8B; mock CMS; text only. "
        f"FAQ and small talk loaded as `draft,approved` (`TRAVIS_CANNED_STATUSES`). **ElevenLabs calls: {meta.get('elevenlabs_calls', 0)}** "
        f"(the streamer is replaced by a tripwire; the quota was not touched).")
    add(f"Cases that used the model were run up to {repeats} times; a case passes only if every run passes. Cases tagged `depends on approval` match "
        f"entries that are still drafts: re-run after your review. Known gaps (already documented) are counted separately.")
    add("")
    main = [c for c in by_case if not info[c]["known_gap"]]
    gap = [c for c in by_case if info[c]["known_gap"]]
    add("## Summary")
    add("")
    add(f"- Cases: **{len(by_case)}** ({len(main)} regular, {len(gap)} known gaps). Turns judged: {len(rows)}.")
    add(f"- Regular cases passing (all runs): **{_pct(sum(status[c][0] for c in main), len(main))}**. Known-gap cases passing: {_pct(sum(status[c][0] for c in gap), len(gap))}.")
    md = [c for c in main if any(r['model_dependent'] for reps in [by_case[c]] for rr in reps.values() for r in rr)]
    add(f"- Model-dependent regular cases: {len(md)}; stable (every run agrees): {sum(1 for c in md if status[c][1] in (0, status[c][2]))}/{len(md)}.")
    add(f"- Depends on approval: {sum(1 for c in main if info[c]['depends_on_approval'])} regular cases.")
    wrong = [r for r in rows if r.get("outcome") == "wrong"]
    add(f"- **Wrong FAQ answers: {len({(r['case'], r['say']) for r in wrong})}** distinct (a wrong answer is the costly failure).")
    add("")
    add("## Pass rate by group")
    add("")
    add("| Group | Cases | Pass (all runs) | Run-level pass | Depends on approval | Model-dependent | Known gaps (pass) |")
    add("|---|---|---|---|---|---|---|")
    for g in GROUP_ORDER:
        cs = [c for c in by_case if info[c]["group"] == g]
        if not cs:
            continue
        reg = [c for c in cs if not info[c]["known_gap"]]
        kg = [c for c in cs if info[c]["known_gap"]]
        runs = [(status[c][1], status[c][2]) for c in reg]
        add(f"| {GROUP_TITLES[g]} | {len(reg)} | {_pct(sum(status[c][0] for c in reg), len(reg))} | {_pct(sum(a for a, _ in runs), sum(b for _, b in runs))} | "
            f"{sum(1 for c in reg if info[c]['depends_on_approval'])} | {sum(1 for c in reg if any(r['model_dependent'] for rr in by_case[c].values() for r in rr))} | "
            f"{len(kg)} ({sum(status[c][0] for c in kg)}) |")
    add("")
    # FAQ outcomes
    outs = Counter(r["outcome"] for r in rows if r.get("outcome") and r["repeat"] == 0)
    if outs:
        add("## FAQ matching outcomes (turns that expect an entry, first run)")
        add("")
        add(f"hit {outs.get('hit', 0)} · miss (passed on to the normal route) {outs.get('miss', 0)} · **wrong entry {outs.get('wrong', 0)}**")
        add("")
    # timing
    add("## Timing by route (transcript to reply text, TTS excluded; every run)")
    add("")
    add("| Route | Turns | p50 | p90 | max |")
    add("|---|---|---|---|---|")
    by_route: dict[str, list[int]] = defaultdict(list)
    for r in rows:
        if r["latency_ms"] is not None:
            by_route[re.sub(r"\s*\(.*", "", r["route"]) or "none"].append(r["latency_ms"])
    for route, v in sorted(by_route.items(), key=lambda kv: -len(kv[1])):
        v.sort()
        p90 = v[min(len(v) - 1, int(0.9 * len(v)))]
        add(f"| {route} | {len(v)} | {statistics.median(v):.0f} ms | {p90} ms | {v[-1]} ms |")
    add("")
    # failures
    add("## Every failure")
    add("")
    fails = [(c, reps) for c, reps in by_case.items() if not status[c][0]]
    if not fails:
        add("None.")
    for g in GROUP_ORDER:
        for c, reps in fails:
            if info[c]["group"] != g:
                continue
            tags = []
            if info[c]["known_gap"]:
                tags.append(f"KNOWN GAP: {info[c]['known_gap']}")
            if info[c]["depends_on_approval"]:
                tags.append("depends on approval")
            add(f"### {c} ({GROUP_TITLES[g]}) — passed {status[c][1]} of {status[c][2]} runs" + (f" — {'; '.join(tags)}" if tags else ""))
            seen = set()
            for rep, rr in sorted(reps.items()):
                for r in rr:
                    if r["success"]:
                        continue
                    key = (r["turn"], tuple(r["failures"]), r["reply"])
                    if key in seen:
                        continue
                    seen.add(key)
                    add(f"- run {rep + 1}, turn {r['turn']}/{r['turns']}: said **{r['say']}** → route `{r['route']}`" + (f", entry `{r['entry']}` ({r['canned_score']})" if r["entry"] else "")
                        + f"; failures: `{', '.join(r['failures'])}`")
                    add(f"  - reply: {r['reply'] or '(none)'}")
                    if r["calls"]:
                        add(f"  - CMS calls: {', '.join(r['calls'])}" + (f"; actions {r['actions']}" if r["actions"] else ""))
            add("")
    add("## All cases")
    add("")
    add("| Case | Group | Result | Runs | Route (first run, last turn) | Tags |")
    add("|---|---|---|---|---|---|")
    for c, reps in by_case.items():
        first = reps[min(reps)]
        last = first[-1]
        tags = [t for t, on in (("known gap", bool(info[c]["known_gap"])), ("depends on approval", info[c]["depends_on_approval"]),
                                ("model-dependent", last["model_dependent"])) if on]
        add(f"| {c} | {GROUP_TITLES[info[c]['group']]} | {'pass' if status[c][0] else 'FAIL'} | {status[c][1]}/{status[c][2]} | {last['route']} | {', '.join(tags)} |")
    text = "\n".join(L) + "\n"
    out_path.write_text(text, encoding="utf-8")
    return text
