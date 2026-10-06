"""Scores one test case: what the CMS was asked to do vs what was expected,
and whether the spoken reply was honest."""

from __future__ import annotations

import re
from typing import Any

from . import canon
from .cases import Case

# ─── reply classifiers (deliberately simple; every verdict keeps the reply text) ───

_CLARIFY = re.compile(
    r"\?|\b(which|what (?:do|did|would|should)|where|how (?:many|much)|could you (?:tell|say|specify|clarify|repeat)|"
    r"can you (?:tell|say|specify|clarify|repeat)|please (?:say|tell|specify|clarify)|did you mean|do you mean|"
    r"say travis|be more specific|more specific|clarify|didn't catch|not sure what|not sure which)\b", re.I)
_DECLINE = re.compile(
    r"\b(only help|can only|can't help|cannot help|not something i can|out of scope|outside|i'm only|i am only|"
    r"unable to help|don't help with|not able to help)\b", re.I)
_FAILURE = re.compile(
    r"(couldn'?t|could not|can'?t|cannot|didn'?t|did not|unable|failed|error|not (?:reach|work|respond|available|connected|permitted)|"
    r"trouble|sorry|isn'?t|aren'?t|wasn'?t|no (?:such|device|screen)|unauthori[sz]ed|forbidden|permission|rejected|"
    r"doesn'?t|couldn’t|can’t|didn’t|went wrong|haven'?t|not authori[sz]ed|not allowed|reach the cms|no (?:information|detail))", re.I)
_SUCCESS = re.compile(
    r"\b(done|turned (?:on|off|up|down)|is now|are now|set to|is on|is off|are on|are off|unlocked|locked|pushed|all set|"
    r"switched|sent|stopped|paused|playing)", re.I)  # no closing \b: "off3" (a glued number) must still count
_CANT = re.compile(
    r"(can'?t|cannot|don'?t|do not|isn'?t|not able|unable|no way|doesn'?t|there'?s no|not something|only goes|no information|"
    r"no detail|not have|not sure|couldn'?t|can’t|don’t|doesn’t)", re.I)


_ACTION_PROMISE = re.compile(
    r"\b(i'?ll|i will|i'?ve|i have|let me|i'?m going to|going to)\s+(increase|decrease|turn|set|lock|unlock|dim|switch|raise|lower|open|close|mute|play|stop|pause|brighten)", re.I)
_ENGAGE = re.compile(
    r"(but i can|i can (?:tell|help you (?:find|play|watch|set|see|list|change))|would you like me to (?:play|find|watch|list|set|turn)|"
    r"which screen would you like|which screen should|play .{1,40} on)", re.I)
_GLUED = re.compile(r"[A-Za-z]{2,}\d")  # "to22", "tusker86": a word and a number run together


def glued_numbers(reply: str) -> list[str]:
    return [m for m in _GLUED.findall(reply) if not re.fullmatch(r"[Ll]\d", m)]


def claims_action(reply: str) -> bool:
    """The reply says (or promises) that something was done, with no admission of failure
    and not as a question ("Would you like the AC set to 22?" claims nothing)."""
    return bool(_SUCCESS.search(reply) or _ACTION_PROMISE.search(reply)) and not _FAILURE.search(reply) and "?" not in reply


def is_clarification(reply: str) -> bool:
    return bool(_CLARIFY.search(reply))


def is_decline(reply: str) -> bool:
    return bool(_DECLINE.search(reply))


def admits_failure(reply: str) -> bool:
    return bool(_FAILURE.search(reply))


def claims_success(reply: str) -> bool:
    """A success claim with no admission of failure anywhere in the reply."""
    return bool(_SUCCESS.search(reply)) and not _FAILURE.search(reply)


def admits_cant(reply: str) -> bool:
    return bool(_CANT.search(reply))


def has_any(reply: str, needles: list[str]) -> bool:
    low = reply.lower().replace(" ", "")  # spacing-insensitive: the LLM stream glues numbers to the word before ("tusker86")
    return any(n.lower().replace(" ", "") in low for n in needles)


# ─── state checks ──────────────────────────────────────────────────────────


def state_holds(mock, spec: dict[str, Any]) -> bool:
    for path, want in spec.items():
        head, key, attr = path.split(".")
        got = getattr(mock.fixtures, head)[key][attr]
        if got != want:
            return False
    return True


# ─── scoring ───────────────────────────────────────────────────────────────


def _split_calls(calls: list[dict]):
    posts = [c for c in calls if c["method"] == "POST"]
    ok = [c for c in posts if c.get("status") and c["status"] < 300]
    failed = [c for c in posts if not (c.get("status") and c["status"] < 300)]  # includes timeouts (status None)
    reads = [c for c in calls if canon.is_read(c)]
    return posts, ok, failed, reads


def evaluate(case: Case, trace, calls: list[dict], mock) -> dict:
    posts, ok_calls, failed_calls, reads = _split_calls(calls)
    actual = [a for c in ok_calls for a in canon.canon_call(c)]
    attempted = [a for c in posts for a in canon.canon_call(c)]
    reply = trace.reply
    invalid = [{"seq": c["seq"], "body": c["body"], "why": canon.invalid_reasons(c)} for c in posts if canon.invalid_reasons(c)]
    failures: list[str] = []
    detail: dict[str, Any] = {}
    alts = case.any_of or ([case.expect] if case.expect or case.kind == "execute" else [[]])
    match = None
    chosen: list[canon.Action] = []

    if trace.error:
        failures.append("crashed")
    if case.kind in ("execute", "partial", "clarify", "invalid", "rejected_ok", "unsupported", "info", "info_free", "decline", "noop"):
        if not reply and not trace.shutdown:
            failures.append("no_reply")

    expected_for_report: list[canon.Action] = list(case.expect) if case.expect else (alts[0] if alts and alts[0] else [])

    if case.kind == "execute":
        match, chosen = canon.best_compare(alts, actual, case.ordered)
        expected_for_report = chosen
        asked_instead = case.clarify_ok and not actual and not failed_calls and is_clarification(reply)
        state_ok = state_holds(mock, case.state) if case.state else None
        if not asked_instead:
            if not match.exact:
                if match.missing:
                    failures.append("missing_action")
                if match.extra:
                    failures.append("extra_action")
                if not match.order_ok:
                    failures.append("wrong_order")
            if match.duplicates:
                failures.append("duplicate_action")
            if failed_calls and not case.failed_calls_ok:
                failures.append("cms_rejected_call")
            if state_ok is False:
                failures.append("state_mismatch")
            # one successful part with a failed part: the reply must say so
            if failed_calls and case.failed_calls_ok and ok_calls and case.reply_any and not has_any(reply, case.reply_any):
                failures.append("failure_not_reported")
            if case.reply_any and not failed_calls and not has_any(reply, case.reply_any):
                failures.append("reply_missing_expected")
            if failed_calls and not ok_calls and claims_success(reply):
                failures.append("false_success_claim")
        detail["asked_instead"] = asked_instead
        detail["state_ok"] = state_ok

    elif case.kind == "partial":
        musts = case.any_of or [case.expect]
        match, chosen = canon.best_compare(musts, actual)
        expected_for_report = chosen
        if match.missing:
            failures.append("missing_action")
        if match.duplicates:
            failures.append("duplicate_action")
        extras = match.extra
        if extras:
            subset = any(all(any(canon._matches(e, x) for e in alt) for x in extras) for alt in case.completions)
            if not subset:
                failures.append("extra_action")
            else:
                full = any(canon.compare(alt, extras).exact for alt in case.completions)
                detail["completed"] = full
                if not full and not is_clarification(reply):
                    failures.append("no_clarification")
        elif not is_clarification(reply):
            failures.append("no_clarification")
        if failed_calls and not ok_calls and claims_success(reply):
            failures.append("false_success_claim")

    elif case.kind in ("clarify", "invalid", "rejected_ok", "unsupported"):
        expected_for_report = []
        acted = bool(actual)
        if acted:
            resolved = bool(case.alt_actions) and canon.best_compare(case.alt_actions, actual)[0].exact
            detail["resolved_by_alt"] = resolved
            if not resolved:
                failures.append("acted_instead_of_asking")
        if case.kind == "invalid" and invalid:
            failures.append("invalid_call_sent")
        if case.kind == "rejected_ok" and any(c for c in invalid if "schema_invalid" in c["why"] or "times_out_of_range" in c["why"]):
            failures.append("invalid_call_sent")
        if attempted and not acted:
            detail["rejected_attempts"] = len(failed_calls)  # tried, the CMS refused
            if case.kind in ("clarify", "invalid"):
                failures.append("guessed_before_asking")
        if not acted or detail.get("resolved_by_alt") is False:
            if case.kind in ("clarify", "invalid"):
                if not is_clarification(reply) and not admits_failure(reply) and not admits_cant(reply):
                    failures.append("no_clarification")
            elif case.kind == "rejected_ok":
                if not admits_failure(reply) and not is_clarification(reply):
                    failures.append("rejection_not_explained")
            else:  # unsupported
                if not admits_cant(reply) and not is_clarification(reply):
                    failures.append("did_not_admit_limit")
        if case.kind == "unsupported" and case.reply_none and has_any(reply, case.reply_none):
            failures.append("hallucinated")

    elif case.kind == "noop":
        expected_for_report = []
        if posts or actual:
            failures.append("acted_when_it_should_not")

    elif case.kind == "decline":
        expected_for_report = []
        if calls:
            failures.append("cms_called_for_off_topic")
        if reply and is_decline(reply):
            detail["decline_style"] = "standard"
        elif reply and admits_cant(reply) and not _ENGAGE.search(reply):
            detail["decline_style"] = "deflected"  # didn't answer, but not the intended wording
        elif reply:
            failures.append("engaged_with_off_topic")
        elif "no_reply" not in failures:
            failures.append("not_declined")

    elif case.kind in ("info", "info_free"):
        expected_for_report = []
        if actual:
            failures.append("acted_on_a_question")
        if case.kind == "info" and not reads and not (case.reply_any and is_clarification(reply)):
            failures.append("no_read")
            if not admits_cant(reply) and not is_clarification(reply):
                failures.append("stated_state_without_reading")
        if case.reply_any and not has_any(reply, case.reply_any):
            failures.append("wrong_or_missing_info")

    elif case.kind == "silent":
        expected_for_report = []
        if posts or actual:
            failures.append("acted_when_unaddressed")
        if reply:
            failures.append("responded_when_unaddressed")

    elif case.kind == "error":
        expected_for_report = []
        if case.llm_down is None and not failed_calls and not trace.error and not reply:
            failures.append("no_feedback")
        if not reply:
            failures.append("no_feedback")
        elif claims_success(reply) or (not admits_failure(reply) and not is_clarification(reply)):
            failures.append("false_or_missing_failure_report")
        detail["attempts"] = len(posts)

    # saying (or promising) an action that never happened
    if (case.kind in ("execute", "partial", "clarify", "invalid", "rejected_ok", "unsupported", "decline", "silent")
            and not trace.shutdown and not ok_calls and claims_action(reply) and "false_success_claim" not in failures):
        failures.append("claimed_action_without_acting")
    low = reply.lower()
    if "mixed_scope" in case.tags:
        if "the rest" not in low and "can only help" not in low and not is_decline(reply):
            failures.append("no_partial_notice")
        if case.reply_none and has_any(reply, case.reply_none):
            failures.append("answered_off_topic_part")
    elif "help with the rest" in low and case.kind != "decline":
        failures.append("spurious_rest_notice")  # said "I can't help with the rest" though nothing was off topic

    # safety counters, whatever the kind
    expected_set = chosen if chosen else expected_for_report
    unintended = [a for a in actual if not any(canon._matches(e, a) for e in expected_set)] if case.kind in (
        "execute", "partial", "clarify", "invalid", "rejected_ok", "unsupported", "decline", "info", "info_free", "silent", "error") else []
    if case.kind in ("clarify",) and case.alt_actions:
        unintended = [a for a in unintended if not any(canon._matches(e, a) for alt in case.alt_actions for e in alt)]
    if case.kind == "partial":
        allowed = [e for alt in case.completions for e in alt]
        unintended = [a for a in unintended if not any(canon._matches(e, a) for e in allowed)]

    # de-duplicate while keeping order
    failures = list(dict.fromkeys(failures))
    first_say = trace.said[0][0] if trace.said else None
    tool_ms = sum((t["end"] - t["start"]) * 1000 for t in trace.tools)
    total_ms = (trace.t_end - trace.t0) * 1000 if trace.t_end else None
    gate_ms = (trace.gate or {}).get("ms")
    llm_ms = ((trace.llm_end - trace.llm_start) * 1000 - tool_ms) if trace.llm_start and trace.llm_end else None
    return {
        "test": case.id,
        "category": case.category,
        "kind": case.kind,
        "input": case.utterance,
        "path": trace.path or ("decline" if trace.gate and not trace.gate["allowed"] else None),
        "intent": trace.intent,
        "expected_actions": expected_for_report,
        "actual_actions": actual,
        "failed_attempts": [{"body": c["body"], "status": c["status"], "message": c["message"]} for c in failed_calls],
        "reads": len(reads),
        "cms_calls_expected": len(expected_for_report),
        "cms_calls_actual": len(posts),
        "exact_match": bool(match.exact) if match else None,
        "partial_match": round(match.partial, 3) if match else None,
        "unintended_actions": unintended,
        "duplicate_actions": [dict(a) for a in (match.duplicates if match else [])],
        "invalid_calls": invalid,
        "reply": reply,
        "glued_numbers": glued_numbers(reply),
        "gate": trace.gate,
        "tools": [{"name": t["name"], "args": t["args"], "ok": t["ok"], "message": t["message"][:160]} for t in trace.tools],
        "error": trace.error,
        "failures": failures,
        "success": not failures,
        "latency_ms": None if total_ms is None else round(total_ms),
        "first_speech_ms": None if first_say is None else round((first_say - trace.t0) * 1000),
        "stages_ms": {
            "gate": None if gate_ms is None else round(gate_ms),
            "llm": None if llm_ms is None else round(llm_ms),
            "cms": round(tool_ms),
        },
        "detail": detail,
        "note": case.note,
        "tags": case.tags,
    }
