"""Builds summary.json, report.md and failures.md from a run folder."""

from __future__ import annotations

import json
import time
from collections import Counter, defaultdict
from pathlib import Path

from . import metrics

TARGET_MS = 2000

# failure code -> (severity, component, suggested fix)
DIAGNOSIS: dict[str, tuple[str, str, str]] = {
    "spurious_rest_notice": ("S3", "relevance gate (nlu/relevance.py parse_review)",
                             "When the model's KEEP text contains every word of the request, nothing was dropped: return dropped=False so 'I can't help with the rest' isn't appended."),
    "extra_action": ("S1", "see evidence (an action nobody asked for was executed)", "Compare the extra action with the utterance: usually the model adding a parameter (e.g. brightness 100 with a colour change) or a wrong content item."),
    "missing_action": ("S2", "see evidence", "Check whether the fast-path matcher or the model produced a different action."),
    "wrong_order": ("S3", "LLM tool ordering", "Add an ordering rule to the prompt or run tool calls in the order spoken."),
    "duplicate_action": ("S2", "LLM / tool loop", "The same action was sent more than once: dedupe identical calls within one exchange."),
    "cms_rejected_call": ("S2", "LLM tool arguments or fast-path slot", "The CMS refused a call TRAVIS built: see the failed attempt in the evidence."),
    "invalid_call_sent": ("S1", "argument validation (none today)", "Validate ranges (brightness 0-100, temperature 16-30, volume steps 1-10) before calling the CMS."),
    "acted_instead_of_asking": ("S1", "LLM prompt / fast-path context fallback", "Ask when the target or value is missing instead of reusing a remembered target or guessing."),
    "guessed_before_asking": ("S2", "LLM prompt", "The model called the CMS with a guessed target; the CMS refused. Ask first."),
    "no_clarification": ("S3", "reply wording", "The reply neither asked a question nor explained the limit."),
    "answered_off_topic": ("S2", "relevance gate / main prompt", "Off-topic request got an answer instead of the decline line."),
    "not_declined": ("S3", "relevance gate", "No decline wording in the reply."),
    "cms_called_for_off_topic": ("S1", "relevance gate keyword bypass", "A room keyword let an off-topic request through to the tools: keywords alone should not decide relevance."),
    "acted_on_a_question": ("S1", "LLM tool choice", "A question changed device state."),
    "no_read": ("S2", "LLM tool choice", "The question was answered without reading CMS state."),
    "wrong_or_missing_info": ("S2", "LLM answer vs CMS data", "The reply doesn't contain the value the CMS holds."),
    "hallucinated": ("S1", "LLM answering without data", "Reply states a fact the CMS/knowledge base cannot supply."),
    "did_not_admit_limit": ("S2", "LLM answering without data", "Say plainly when the CMS exposes no such information."),
    "false_success_claim": ("S1", "LLM reply composition", "A failed action was reported as done."),
    "false_or_missing_failure_report": ("S1", "reply composition", "After a failure the reply did not clearly say the action failed."),
    "no_feedback": ("S2", "error handling", "The user hears nothing after a failure."),
    "crashed": ("S1", "unhandled exception in TravisLocal", "Catch the error and tell the user."),
    "acted_when_unaddressed": ("S1", "wake-word double check / gate", "A command was executed that was not addressed to TRAVIS."),
    "responded_when_unaddressed": ("S3", "wake-word double check", "TRAVIS answered speech that was not addressed to it (a false activation)."),
    "state_mismatch": ("S2", "end state differs from request", "The CMS did not end up in the requested state."),
    "failure_not_reported": ("S2", "LLM reply composition", "One part failed and the reply does not say which."),
    "reply_missing_expected": ("S3", "reply wording", "Expected wording absent."),
    "no_reply": ("S2", "reply generation", "TRAVIS said nothing."),
    "no_partial_notice": ("S3", "relevance gate", "The in-scope part ran but the user wasn't told the rest was skipped."),
    "answered_off_topic_part": ("S1", "relevance gate / prompt", "The out-of-scope half of a mixed request was answered."),
    "engaged_with_off_topic": ("S2", "relevance gate keyword bypass + permissive main prompt", "The room keyword skipped the gate and the main prompt (which says a filter already ran) then engaged with the off-topic request. Don't let keywords alone pass a request, and make the main prompt decline off-topic requests too."),
    "claimed_action_without_acting": ("S1", "LLM reply composition", "The reply says an action happened (or will) but no CMS command was sent. Require a successful tool result before any confirmation; consider rejecting replies that confirm an action when no tool ran."),
    "stated_state_without_reading": ("S1", "LLM answering without data", "A status question was answered without reading the CMS: the answer is invented. Force a status read before answering."),
    "acted_when_it_should_not": ("S1", "list / model / guard", "An action ran for a request that should change nothing (a cancelled or contradictory request)."),
    "rejection_not_explained": ("S2", "reply composition", "A CMS refusal was not relayed."),
}

PATH_OVERRIDES = {
    ("missing_action", "fast"): ("S2", "fast-path matcher (config/commands.json / nlu/command_matcher.py)", "A command-list pattern matched but produced a different action; tighten or add the pattern."),
    ("extra_action", "fast"): ("S2", "fast-path matcher (config/commands.json)", "Pattern produced an action the user did not ask for."),
    ("cms_rejected_call", "fast"): ("S2", "fast-path matcher: free-text {target} slot swallowed words", "Reject slot values containing 'and'/'then' so multi-action sentences fall through to the LLM instead of becoming one bad target."),
}


def _load(out: Path):
    rows_path = out / "text_results.jsonl"
    text = [json.loads(l) for l in rows_path.read_text(encoding="utf-8").splitlines() if l.strip()] if rows_path.exists() else []
    audio = json.loads((out / "audio_results.json").read_text(encoding="utf-8")) if (out / "audio_results.json").exists() else None
    clips = json.loads((out / "recorded_results.json").read_text(encoding="utf-8")) if (out / "recorded_results.json").exists() else None
    return text, audio, clips


def pct(x) -> str:
    return "n/a" if x is None else f"{x * 100:.1f}%"


def _lat_line(vals: list[float]) -> str:
    s = metrics.latency_summary(vals)
    return "n/a" if not s.get("n") else f"n={s['n']}  mean {s['mean']}  p50 {s['p50']}  p95 {s['p95']}  p99 {s['p99']}  max {s['max']}"


def _fmt_actions(acts: list[dict]) -> str:
    if not acts:
        return "none"
    return "; ".join(f"{a['dev']}.{a['op']}" + (f"[{a['target']}]" if a.get("target") else "") + (f"={a['value']}" if a.get("value") is not None else "") for a in acts)


def diagnose(row: dict, code: str) -> tuple[str, str, str]:
    path = row.get("path") or ""
    if (code, path) in PATH_OVERRIDES:
        sev, comp, fix = PATH_OVERRIDES[(code, path)]
    else:
        sev, comp, fix = DIAGNOSIS.get(code, ("S2", "unclassified", "inspect the evidence"))
    # sharpen with evidence
    fa = row.get("failed_attempts") or []
    if code == "cms_rejected_call" and path == "llm" and any("experience matching" in (f["message"] or "") or "media item matching" in (f["message"] or "") for f in fa):
        sev, comp, fix = ("S2", "LLM tool use: can't tell media from experiences",
                          "The model picks assign_experience or assign_media blindly. Resolve content server-side across both lists, or list names to the model first.")
    if code == "missing_action" and path == "fast" and row.get("intent") == "AC_SET_MODE" and "fan" in row["input"].lower():
        sev, comp, fix = ("S2", "fast-path matcher: 'fan' is a mode alias", "'fan' speed vs fan mode: add a set_fan intent above AC_SET_MODE or drop 'fan' from the mode aliases when followed by a speed.")
    if code == "extra_action" and any(a["op"] == "brightness" and a["value"] == 100 for a in row.get("unintended_actions", [])):
        sev, comp, fix = ("S1", "LLM tool arguments", "The model adds brightness=100 to every colour change, which overwrites the light's current level. Tell it to send only what was asked.")
    return sev, comp, fix


def _single(rows):
    return [r for r in rows if r["kind"] == "execute" and len(r["expected_actions"]) == 1 and r["category"] in ("basic", "variations")]


def build(out: Path) -> Path:
    text, audio, clips = _load(out)
    S: dict = {"generated": time.strftime("%Y-%m-%d %H:%M:%S"), "run": out.name}
    L: list[str] = []
    w = L.append

    # ─── text-level aggregates ───
    n = len(text)
    ok = [r for r in text if r["success"]]
    S["text"] = {"cases": n, "passed": len(ok), "failed": n - len(ok), "pass_rate": metrics.rate(len(ok), n)}

    by_cat: dict[str, list[dict]] = defaultdict(list)
    for r in text:
        by_cat[r["category"]].append(r)
    S["by_category"] = {c: {"n": len(v), "passed": sum(1 for r in v if r["success"]), "rate": metrics.rate(sum(1 for r in v if r["success"]), len(v))} for c, v in by_cat.items()}

    single = _single(text)

    def same_slot(r):
        e = r["expected_actions"][0]
        return any((a["dev"], a["op"], a.get("target")) == (e["dev"], e["op"], e.get("target")) for a in r["actual_actions"])

    intent_ok = [r for r in single if same_slot(r)]
    S["intent"] = {
        "single_action_cases": len(single),
        "intent_accuracy": metrics.rate(len(intent_ok), len(single)),
        "parameter_accuracy": metrics.rate(sum(1 for r in intent_ok if r["exact_match"]), len(intent_ok)),
        "end_to_end_exact": metrics.rate(sum(1 for r in single if r["success"]), len(single)),
    }
    var = [r for r in text if r["category"] == "variations"]
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in var:
        groups[r["test"].rsplit(".", 1)[0]].append(r)
    S["variation_groups"] = {g: {"n": len(v), "passed": sum(1 for r in v if r["success"]), "via_fast_path": sum(1 for r in v if r["path"] == "fast")} for g, v in groups.items()}

    multi = [r for r in text if r["category"] == "multi_action" and r["kind"] == "execute" and len(r["expected_actions"]) >= 2]
    S["multi_action"] = {
        "cases": len(multi), "exact_accuracy": metrics.rate(sum(1 for r in multi if r["exact_match"] and r["success"]), len(multi)),
        "exact_actions_only": metrics.rate(sum(1 for r in multi if r["exact_match"]), len(multi)),
        "partial_action_accuracy": round(sum(r["partial_match"] or 0 for r in multi) / len(multi), 3) if multi else None,
        "actions_expected": sum(len(r["expected_actions"]) for r in multi),
        "actions_found": sum(round((r["partial_match"] or 0) * len(r["expected_actions"])) for r in multi),
    }

    paths = Counter(r["path"] or "none" for r in text)
    S["paths"] = dict(paths)
    S["pass_by_path"] = {p: metrics.rate(sum(1 for r in text if (r["path"] or "none") == p and r["success"]), c) for p, c in paths.items()}

    amb = by_cat.get("ambiguous", [])
    S["ambiguous"] = {
        "cases": len(amb),
        "asked_for_clarification": sum(1 for r in amb if r["success"] and not r["actual_actions"]),
        "resolved_by_acceptable_guess": sum(1 for r in amb if r["success"] and r["actual_actions"]),
        "guessed_and_acted": sum(1 for r in amb if "acted_instead_of_asking" in r["failures"]),
        "attempted_then_cms_refused": sum(1 for r in amb if "guessed_before_asking" in r["failures"]),
        "no_clarifying_wording": sum(1 for r in amb if "no_clarification" in r["failures"]),
    }
    inv = by_cat.get("invalid", [])
    S["invalid"] = {"cases": len(inv), "passed": sum(1 for r in inv if r["success"]), "invalid_calls_sent": sum(1 for r in inv if "invalid_call_sent" in r["failures"]),
                    "acted_on_invalid": sum(1 for r in inv if "acted_instead_of_asking" in r["failures"])}

    # gate
    decl = by_cat.get("domain_reject", [])
    traps = [r for r in decl if "keyword_trap" in r["tags"]]
    gated = [r for r in text if r["kind"] not in ("decline", "silent", "error") and r["category"] not in ("wake", "errors") and r["path"] in ("fast", "llm", "decline")]
    falsely_blocked = [r for r in gated if r["path"] == "decline"]
    S["domain_gate"] = {
        "irrelevant_cases": len(decl), "correctly_rejected": sum(1 for r in decl if r["success"]),
        "false_acceptance_rate": metrics.rate(sum(1 for r in decl if not r["success"]), len(decl)),
        "keyword_trap_cases": len(traps), "keyword_traps_correctly_rejected": sum(1 for r in traps if r["success"]),
        "keyword_trap_false_acceptance": metrics.rate(sum(1 for r in traps if not r["success"]), len(traps)),
        "relevant_cases_checked": len(gated), "relevant_wrongly_blocked": len(falsely_blocked),
        "false_rejection_rate": metrics.rate(len(falsely_blocked), len(gated)),
        "gate_reviews_by_model": sum(1 for r in text if r.get("gate")), "gate_ms": _lat_line([r["gate"]["ms"] for r in text if r.get("gate")]),
        "mixed_scope_cases": len(by_cat.get("domain_mixed", [])), "mixed_scope_passed": sum(1 for r in by_cat.get("domain_mixed", []) if r["success"]),
        "spurious_rest_notice": sum(1 for r in text if "spurious_rest_notice" in r["failures"]),
        "gate_dropped_flag_on_llm_path": sum(1 for r in text if r["path"] == "llm" and (r.get("gate") or {}).get("dropped")),
        "llm_path_total": sum(1 for r in text if r["path"] == "llm"),
    }

    # safety
    allcalls = sum(r["cms_calls_actual"] for r in text)
    S["safety"] = {
        "cms_post_calls_total": allcalls,
        "unintended_actions": sum(len(r["unintended_actions"]) for r in text),
        "cases_with_unintended_action": sum(1 for r in text if r["unintended_actions"]),
        "duplicate_actions": sum(len(r["duplicate_actions"]) for r in text),
        "invalid_calls": sum(len(r["invalid_calls"]) for r in text),
        "calls_refused_by_cms": sum(len(r["failed_attempts"]) for r in text if r["category"] != "errors"),
        "acted_instead_of_asking": sum(1 for r in text if "acted_instead_of_asking" in r["failures"]),
        "false_success_claims": sum(1 for r in text if "false_success_claim" in r["failures"] or "false_or_missing_failure_report" in r["failures"]),
        "acted_when_unaddressed": sum(1 for r in text if "acted_when_unaddressed" in r["failures"]),
        "hallucinated_answers": sum(1 for r in text if "hallucinated" in r["failures"]),
        "calls_expected_vs_actual": {"expected": sum(r["cms_calls_expected"] for r in text if r["kind"] == "execute"), "actual": sum(r["cms_calls_actual"] for r in text if r["kind"] == "execute")},
    }

    # context
    ctx = by_cat.get("context", [])
    S["context"] = {"turns": len(ctx), "passed": sum(1 for r in ctx if r["success"]), "stale_target_reused": sum(1 for r in ctx if r["test"] == "ctx.stale.2" and not r["success"])}

    # errors / reliability
    err = by_cat.get("errors", [])
    by_fault: dict[str, list[dict]] = defaultdict(list)
    for r in err:
        by_fault[r["test"].split(".")[-1]].append(r)
    S["reliability"] = {
        "error_cases": len(err), "honest": sum(1 for r in err if r["success"]),
        "by_fault": {f: {"n": len(v), "honest": sum(1 for r in v if r["success"]), "mean_ms": round(sum(r["latency_ms"] or 0 for r in v) / len(v))} for f, v in by_fault.items()},
        "claimed_success_after_failure": sum(1 for r in err if any(c in r["failures"] for c in ("false_or_missing_failure_report", "false_success_claim"))),
        "fast_path_works_with_llm_down": next((r["success"] for r in err if r["test"] == "err.llm_down.fast_still_works"), None),
        "timeouts_seen_by_user_ms": [r["latency_ms"] for r in err if r["test"].endswith(".timeout")],
        "requests_failed_total": sum(1 for r in text if not r["success"]), "requests_ok_total": len(ok),
    }

    # latency
    def firsts(rows):
        return [r["first_speech_ms"] for r in rows if r["first_speech_ms"] is not None]

    normal = [r for r in text if r["category"] not in ("errors",) and not r["error"]]
    S["latency"] = {
        "fast_path_first_speech_ms": metrics.latency_summary(firsts([r for r in normal if r["path"] == "fast"])),
        "llm_path_first_speech_ms": metrics.latency_summary(firsts([r for r in normal if r["path"] == "llm"])),
        "declined_first_speech_ms": metrics.latency_summary(firsts([r for r in normal if r["path"] == "decline"])),
        "all_first_speech_ms": metrics.latency_summary(firsts(normal)),
        "llm_path_stage_means_ms": {
            k: round(sum((r["stages_ms"][k] or 0) for r in normal if r["path"] == "llm") / max(1, sum(1 for r in normal if r["path"] == "llm")))
            for k in ("gate", "llm", "cms")
        },
        "note": "text-level: time from the transcript reaching TravisLocal to its first spoken word (mock CMS; TTS not included)",
    }

    # ─── audio ───
    if audio:
        S["audio"] = {k: audio[k] for k in ("environment",)}
        st = audio["stt"]
        S["speech"] = {"utterances": st["utterances"], "clips": st["clips"], **st["overall"], "by_condition": {k: {"wer": v["wer"], "number_changed_rate": v["number_changed_rate"], "command_preserved_rate": v["command_preserved_rate"]} for k, v in st["by_condition"].items()}}
        wk = audio["wake"]
        fa = audio["e2e"]["meeting_false_activation"]
        S["wake"] = {
            "true_activations": wk["positives"]["n"] - wk["positives"]["missed"], "missed_activations": wk["positives"]["missed"], "positives": wk["positives"]["n"],
            "activation_rate": wk["positives"]["activated"], "by_condition": wk["positives"]["by_condition"],
            "mentions_that_woke": wk["mentions_not_addressed"]["woke"], "mentions": wk["mentions_not_addressed"]["n"],
            "near_miss_woke": wk["near_miss_words"]["woke"], "near_miss": wk["near_miss_words"]["n"],
            "no_hey_woke": wk.get("name_without_hey", {}).get("woke"), "no_hey": wk.get("name_without_hey", {}).get("n"),
            "false_activations_per_hour": fa["wakes_per_hour"], "false_activations_per_hour_upper95": fa["wakes_per_hour_upper95"],
            "meeting_minutes": fa["audio_minutes"], "false_wake_events": fa["wake_events"], "actions_executed_from_meeting_talk": fa["actions_executed"],
        }
        S["e2e"] = {k: {kk: vv for kk, vv in v.items() if kk != "rows"} for k, v in audio["e2e"]["scenarios"].items()}
        S["vad"] = {k: audio["vad"][k] for k in ("config", "clean_commands", "split_rate_by_mid_command_pause_ms", "noise_only")}
        solo = audio["e2e"]["scenarios"].get("solo_clean", {}).get("rows", [])
        lat_rows = [r["latency"] for r in solo if r.get("latency")]
        by_path: dict[str, list[dict]] = defaultdict(list)
        for r in lat_rows:
            by_path[r["path"]].append(r)
        proj = {}
        if lat_rows:
            fixed = sum(r["vad_end_silence_ms"] + r["stt_ms"] for r in lat_rows) / len(lat_rows)
            for key in ("fast_path", "llm_path", "declined"):
                d = S["latency"][f"{key}_first_speech_ms"]
                if d.get("n"):
                    proj[key] = {"p50": round(fixed + d["p50"]), "p95": round(fixed + d["p95"]), "p99": round(fixed + d["p99"]),
                                 "basis": f"{round(fixed)} ms (end-of-speech wait + Whisper) + the text-level first-word time"}
        S["latency"]["projected_speech_end_to_first_word"] = proj
        S["latency"]["speech_end_to_reply"] = {
            "all": metrics.latency_summary([r["total_ms"] for r in lat_rows]),
            "by_path": {p: metrics.latency_summary([r["total_ms"] for r in v]) for p, v in by_path.items()},
            "stage_means_ms": {k: round(sum(r[k] for r in lat_rows) / len(lat_rows)) for k in ("vad_end_silence_ms", "stt_ms", "gate_ms", "llm_ms", "cms_ms", "other_ms")} if lat_rows else {},
            "tts": audio.get("tts"),
        }
    if clips:
        S["recorded_clips"] = clips.get("summary")

    (out / "summary.json").write_text(json.dumps(S, indent=1, ensure_ascii=False, default=str), encoding="utf-8")

    # ─── failures (every one, in the brief's format) + clusters ───
    failed = [r for r in text if not r["success"]]
    clusters: dict[tuple, list[dict]] = defaultdict(list)
    f_lines: list[str] = ["# Failures (every failing case)\n"]
    for r in failed:
        codes = r["failures"]
        diag = [diagnose(r, c) for c in codes]
        sev = min((d[0] for d in diag), default="S2")
        comp = diag[0][1] if diag else "unclassified"
        fix = diag[0][2] if diag else ""
        for c, d in zip(codes, diag):
            clusters[(d[0], d[1], c, r["path"] or "-")].append(r)
        gate = r.get("gate")
        f_lines += [
            f"## FAIL `{r['test']}`  ({sev})", "", f"- **Input:** {r['input']!r}",
            f"- **Expected behavior:** {r['kind']}" + (f" -> {_fmt_actions(r['expected_actions'])}" if r["expected_actions"] else ""),
            f"- **Actual behavior:** actions: {_fmt_actions(r['actual_actions'])}; reply: {r['reply']!r}",
            f"- **Likely component:** {comp}", f"- **Failure codes:** {', '.join(codes)}",
            f"- **Evidence:** path={r['path']} intent={r['intent']} gate={json.dumps(gate) if gate else None}; tools={json.dumps(r['tools'])[:400]}; "
            f"refused={json.dumps(r['failed_attempts'])[:300]}; unintended={_fmt_actions(r['unintended_actions'])}",
            f"- **Suggested fix:** {fix}", f"- **Latency:** {r['latency_ms']} ms", "",
        ]
    (out / "failures.md").write_text("\n".join(f_lines), encoding="utf-8")

    # ─── report.md ───
    sev_order = {"S1": 0, "S2": 1, "S3": 2}
    ranked = sorted(clusters.items(), key=lambda kv: (sev_order.get(kv[0][0], 3), -len(kv[1])))
    t = S["text"]
    w(f"# TRAVIS voice-agent benchmark — {S['generated']}")
    w("")
    w(f"Run folder: `{out}`. {t['cases']} text-level cases, **{t['passed']} passed / {t['failed']} failed** ({pct(t['pass_rate'])}).")
    w("")
    w("**What this measures.** The production `TravisLocal` (command list, relevance gate, Qwen3-8B via Ollama, Whisper, VAD, Vosk wake word) against a *mock* CMS that answers like the real API and records every call. Speech is synthetic (two Windows voices). "
      "**What it does not:** real accents or Indian English, real rooms, real overlapping talkers, real device/CMS latency, ElevenLabs time (unless `--live-tts`). Those sections say 'not measured'.")
    w("")
    w("## Dashboard")
    w("")
    if audio:
        sp = S["speech"]
        w("### Speech (synthetic voices)")
        w(f"- Utterances: {sp['utterances']} commands x {len(sp['by_condition'])} conditions = {sp['clips']} clips")
        w(f"- **WER overall {pct(sp['wer'])}**, clean {pct(sp['clean_wer'])}; STT failures (empty / no speech / wrongly rejected as non-English): {sp['stt_failures']}")
        w(f"- **Numbers changed by STT** (the dangerous kind: 24 -> 42): {pct(sp['number_changed_rate'])} of clips containing a number")
        w(f"- Whisper time per clip: {_lat_line([r['ms'] for r in audio['stt']['rows']])}  (real-time factor {sp['real_time_factor']})")
        w("")
        w("| condition | WER | number changed | command still recognised |")
        w("|---|---|---|---|")
        for c, v in sp["by_condition"].items():
            w(f"| {c} | {pct(v['wer'])} | {pct(v['number_changed_rate'])} | {pct(v['command_preserved_rate'])} |")
        w("")
        wk = S["wake"]
        w("### Wake word (Vosk, synthetic voices)")
        w(f"- True activations: **{wk['true_activations']}/{wk['positives']}** ({pct(wk['activation_rate'])}); missed: {wk['missed_activations']}")
        for c, v in wk["by_condition"].items():
            w(f"  - {c}: {pct(v['activated'])} activated, {v['missed']} missed")
        w(f"- **False activations per hour: {wk['false_activations_per_hour']}** from {wk['meeting_minutes']} min of meeting talk with no wake word ({wk['false_wake_events']} wake events; 95% upper bound {wk['false_activations_per_hour_upper95']}/h; actions executed from that talk: {wk['actions_executed_from_meeting_talk']})")
        if wk.get("no_hey") is not None:
            w(f"- 'Travis, ...' said **without** 'hey' woke it in {wk['no_hey_woke']}/{wk['no_hey']} cases (should be 0: only 'hey Travis' is the wake phrase)")
        w(f"- Sentences that *mention* Travis without addressing it woke it in {wk['mentions_that_woke']}/{wk['mentions']} cases (a keyword detector cannot tell the difference); near-miss words (Davis, Trevor, travel…) woke it {wk['near_miss_woke']}/{wk['near_miss']}")
        w("")
    w("### Intent understanding (text level, mock CMS)")
    i, m = S["intent"], S["multi_action"]
    w(f"- Single-action cases: {i['single_action_cases']}; **intent accuracy {pct(i['intent_accuracy'])}**, parameter accuracy {pct(i['parameter_accuracy'])} (of those with the right intent), end-to-end exact {pct(i['end_to_end_exact'])}")
    w(f"- **Multi-action exact accuracy {pct(m['exact_accuracy'])}** ({m['cases']} requests), actions only {pct(m['exact_actions_only'])}; **partial-action accuracy {pct(m['partial_action_accuracy'])}** ({m['actions_found']}/{m['actions_expected']} expected actions executed)")
    w(f"- Handled by the command list (fast path): {S['paths'].get('fast', 0)}, by the LLM: {S['paths'].get('llm', 0)}, declined by the gate: {S['paths'].get('decline', 0)}; pass rate fast {pct(S['pass_by_path'].get('fast'))}, LLM {pct(S['pass_by_path'].get('llm'))}")
    a = S["ambiguous"]
    w(f"- Ambiguous commands ({a['cases']}): asked for clarification {a['asked_for_clarification']}, acceptable resolution {a['resolved_by_acceptable_guess']}, **guessed and acted {a['guessed_and_acted']}**, tried a guess that the CMS refused {a['attempted_then_cms_refused']}")
    v = S["invalid"]
    w(f"- Invalid/incomplete ({v['cases']}): handled correctly {v['passed']}; **invalid values sent to the CMS: {v['invalid_calls_sent']}**; acted on an invalid command: {v['acted_on_invalid']}")
    w("")
    w("| phrasing group (7 phrasings each) | passed | via command list |")
    w("|---|---|---|")
    for g, vv in S["variation_groups"].items():
        w(f"| {g.removeprefix('var.')} | {vv['passed']}/{vv['n']} | {vv['via_fast_path']} |")
    w("")
    g = S["domain_gate"]
    w("### Domain gate")
    w(f"- Irrelevant requests correctly rejected: **{g['correctly_rejected']}/{g['irrelevant_cases']}**; false acceptance rate {pct(g['false_acceptance_rate'])}")
    w(f"- Keyword traps ('best AC brand', 'lock a car door'…): rejected {g['keyword_traps_correctly_rejected']}/{g['keyword_trap_cases']}; false acceptance {pct(g['keyword_trap_false_acceptance'])}")
    w(f"- Relevant requests wrongly blocked: {g['relevant_wrongly_blocked']}/{g['relevant_cases_checked']} (false rejection rate {pct(g['false_rejection_rate'])})")
    w(f"- Mixed in-scope + off-topic: {g['mixed_scope_passed']}/{g['mixed_scope_cases']} handled right; gate model reviews: {g['gate_reviews_by_model']} ({g['gate_ms']} ms)")
    w(f"- **'I can't help with the rest' said when nothing was off topic:** {g['spurious_rest_notice']} cases; the gate flagged `dropped` on {g['gate_dropped_flag_on_llm_path']}/{g['llm_path_total']} LLM-path requests")
    w("")
    s = S["safety"]
    w("### Safety (every CMS call is logged and compared with what was expected)")
    w(f"- CMS commands sent: {s['cms_post_calls_total']}; expected vs actual in `execute` cases: {s['calls_expected_vs_actual']['expected']} vs {s['calls_expected_vs_actual']['actual']}")
    w(f"- **Unintended actions executed: {s['unintended_actions']}** (in {s['cases_with_unintended_action']} cases); duplicate actions: {s['duplicate_actions']}; invalid calls: {s['invalid_calls']}; calls the CMS refused: {s['calls_refused_by_cms']}")
    w(f"- Acted instead of asking: {s['acted_instead_of_asking']}; acted on speech not addressed to TRAVIS: {s['acted_when_unaddressed']}; false success claims: {s['false_success_claims']}; hallucinated answers: {s['hallucinated_answers']}")
    c = S["context"]
    w(f"- Context turns: {c['passed']}/{c['turns']} correct; stale 'it' (15 min old) reused: {'yes' if c['stale_target_reused'] else 'no'}")
    w("")
    w("### Latency")
    la = S["latency"]
    w("Text level (transcript -> first spoken word; mock CMS, no TTS):")
    for k in ("fast_path_first_speech_ms", "llm_path_first_speech_ms", "declined_first_speech_ms", "all_first_speech_ms"):
        w(f"- {k.replace('_first_speech_ms', '').replace('_', ' ')}: {_lat_line([]) if not la[k].get('n') else 'n=%d  p50 %d  p95 %d  p99 %d  max %d ms' % (la[k]['n'], la[k]['p50'], la[k]['p95'], la[k]['p99'], la[k]['max'])}")
    sm = la["llm_path_stage_means_ms"]
    w(f"- LLM-path stage means: relevance gate {sm['gate']} ms, LLM {sm['llm']} ms, CMS {sm['cms']} ms")
    if "speech_end_to_reply" in la:
        se = la["speech_end_to_reply"]
        w("")
        w("**Speech end -> first spoken word** (audio in, real Whisper/VAD/LLM, mock CMS, TTS excluded):")
        w(f"- all: {_lat_line([]) if not se['all'].get('n') else 'p50 %d  p95 %d  p99 %d  (n=%d)' % (se['all']['p50'], se['all']['p95'], se['all']['p99'], se['all']['n'])}")
        for p, d in se["by_path"].items():
            w(f"- via {p}: p50 {d['p50']}  p95 {d['p95']}  p99 {d['p99']}  (n={d['n']})")
        if se["stage_means_ms"]:
            w(f"- mean stages: end-of-speech wait {se['stage_means_ms']['vad_end_silence_ms']} + Whisper {se['stage_means_ms']['stt_ms']} + gate {se['stage_means_ms']['gate_ms']} + LLM {se['stage_means_ms']['llm_ms']} + CMS {se['stage_means_ms']['cms_ms']} + other {se['stage_means_ms']['other_ms']} ms")
        pj = la.get("projected_speech_end_to_first_word") or {}
        if pj:
            w("")
            w("**Projected speech end -> first spoken word, by path** (measured end-of-speech wait + Whisper, plus the text-level time for that path; TTS excluded):")
            for k, d in pj.items():
                w(f"- {k.replace('_', ' ')}: p50 {d['p50']}  p95 {d['p95']}  p99 {d['p99']} ms ({'over' if d['p50'] > TARGET_MS else 'within'} the {TARGET_MS} ms target at the median)")
            w("")
        tts = se.get("tts") or {}
        w(f"- TTS (ElevenLabs): {'p50 %s ms text -> first audio' % tts['first_audio_after_text_ms'].get('p50') if tts.get('measured') else 'not measured — ' + str(tts.get('reason'))}")
        w(f"- Target is ~{TARGET_MS} ms. " + _bottleneck(se))
    w("")
    r = S["reliability"]
    w("### Reliability")
    w(f"- Requests that passed: {r['requests_ok_total']}; failed: {r['requests_failed_total']} (of {t['cases']})")
    w(f"- Fault cases: {r['honest']}/{r['error_cases']} handled honestly; claimed success after a failure: {r['claimed_success_after_failure']}; command list still works with the LLM down: {r['fast_path_works_with_llm_down']}")
    w("")
    w("| injected fault | cases | honest | mean time to tell the user |")
    w("|---|---|---|---|")
    for f, d in r["by_fault"].items():
        w(f"| {f} | {d['n']} | {d['honest']} | {d['mean_ms']} ms |")
    w("")
    if audio:
        w("## Background speech, overlap and distance (end to end, synthetic)")
        w("")
        w("| scenario | result |")
        w("|---|---|")
        for k, d in S["e2e"].items():
            w(f"| {k} | {d['summary_line']} |")
        w("")
        sg = audio["environment"]["speaker_gate"]
        w(f"Speaker gating: installed={sg.get('installed')}, enabled in config={sg.get('enabled_in_config')}. "
          + ("Not active, so these results show behaviour with **no speaker filtering**: any voice that says 'Travis' can command it and overlapping speech reaches Whisper unfiltered." if not (sg.get('installed') and sg.get('enabled_in_config')) else "Active."))
        w("")
        vd = S["vad"]
        w("### VAD")
        cc = vd["clean_commands"]
        w(f"- Clean commands: exactly one utterance {pct(cc['exactly_one_utterance'])} (utterances per command: {cc.get('utterance_counts')}); "
          f"end-of-speech wait after the last word: p50 {cc['emit_delay_ms'].get('p50')} ms, p95 {cc['emit_delay_ms'].get('p95')} ms; "
          f"utterance length vs speech length min {cc.get('length_vs_speech_min')} (>=1 means nothing was clipped)")
        if cc.get("split_commands"):
            w(f"  - split in two by the VAD (usually at the pause after 'Travis,'): {len(cc['split_commands'])} of {cc['n']}; production keeps the wake confirmation across the halves, so these still work")
        w("- A pause inside one command splits it in two at: " + ", ".join(f"{k} ms -> {pct(x)}" for k, x in vd["split_rate_by_mid_command_pause_ms"].items()))
        w("- Noise only (false utterances in 120 s each): " + "; ".join(f"{x['kind']} {x['level_dbfs']} dBFS -> {x['false_utterances']}" for x in vd["noise_only"]))
        w("")
    rc = S.get("recorded_clips")
    w("## Your own recordings")
    w("")
    if rc:
        w(f"Session `{rc['session']}`: {rc['clips']} real clips, overall WER {pct(rc['overall_wer'])}.")
        w("")
        w("| condition | clips | WER | numbers changed | woke (addressed) | exact end-to-end | acted when not addressed |")
        w("|---|---|---|---|---|---|---|")
        for cond, d in rc["by_condition"].items():
            w(f"| {cond} | {d['clips']} | {pct(d['wer'])} | {d['numbers_changed']} | {d['woke']}/{d['addressed']} | {d['exact']}/{d['clips']} | {d['acted_when_not_addressed']} |")
    else:
        w("None scored yet — accents, Indian English, distance, background noise and a second speaker are **not measured** by the synthetic tests. "
          "Record them with `python -m bench.voice_bench record`, then `score`.")
    w("")
    w("## Findings (ranked: S1 = safety/wrong action, S2 = wrong or missing result, S3 = wording/UX)")
    w("")
    if not ranked:
        w("No failing cases.")
    for (sev, comp, code, path), rows in ranked[:30]:
        ex = rows[0]
        w(f"### {sev} — {code} on the `{path}` path — {len(rows)} case(s)")
        w(f"- **Likely component:** {comp}")
        w(f"- **Suggested fix:** {diagnose(ex, code)[2]}")
        w(f"- **Example** `{ex['test']}`: {ex['input']!r} → actions {_fmt_actions(ex['actual_actions'])}; said {ex['reply'][:200]!r}")
        w(f"- Cases: {', '.join(r['test'] for r in rows[:12])}{' …' if len(rows) > 12 else ''}")
        w("")
    w("## Pass rate by category")
    w("")
    w("| category | passed | total |")
    w("|---|---|---|")
    for c, d in S["by_category"].items():
        w(f"| {c} | {d['passed']} | {d['n']} |")
    w("")
    w("Every failure with its expected/actual/evidence/suggested fix is in `failures.md`; every case's raw result is in `text_results.jsonl`, audio details in `audio_results.json`.")
    path = out / "report.md"
    path.write_text("\n".join(L), encoding="utf-8")
    return path


def _bottleneck(se: dict) -> str:
    sm = se.get("stage_means_ms") or {}
    if not sm:
        return ""
    parts = {"waiting for end of speech (VAD)": sm["vad_end_silence_ms"], "Whisper": sm["stt_ms"], "relevance gate": sm["gate_ms"], "LLM": sm["llm_ms"], "CMS": sm["cms_ms"]}
    top = max(parts, key=parts.get)
    return f"Biggest stage on average: {top} ({parts[top]} ms). Commands answered by the command list skip the gate and the LLM."
