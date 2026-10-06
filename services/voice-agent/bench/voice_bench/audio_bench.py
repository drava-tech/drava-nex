"""Audio-level benchmark: Whisper accuracy, VAD, the Vosk wake word, background
meeting speech, overlapping talkers, and the speech-end -> reply latency budget.

Everything runs the production components (WhisperSTT, Endpointer, the
VoskWakeWordDetector class, TravisLocal) on synthetic speech (audio_synth.py).
The mic callback itself needs a sound device, so MicSim reproduces its logic
(16-chunk pre-roll, the wake debounce, the 8 s awake window, the VAD feed);
audio is processed faster than real time, so speech that arrives while a
command is being executed is not dropped the way it would be live.
"""

from __future__ import annotations

import asyncio
import json
import platform
import time
from collections import deque
from pathlib import Path
from unittest import mock as umock

import numpy as np

from . import audio_synth as syn
from . import audio_texts as texts
from . import canon, metrics
from .agent import BenchAgent, bench_env
from .mock_cms import MockCms
from .names import Fixtures

import settings  # noqa: E402  (BenchAgent already put the agent root on sys.path)
from agent.vocabulary import stt_vocabulary  # noqa: E402
from wake.detectors import VoskWakeWordDetector  # noqa: E402
from nlu.command_matcher import match_command  # noqa: E402
from speech.stt import WhisperSTT  # noqa: E402
from speech.transcript_gate import strip_wake_word  # noqa: E402
from speech.vad import Endpointer  # noqa: E402

CHUNK = 1024  # the mic callback's blocksize
ROOT = Path(__file__).resolve().parents[2]
SMALL_MODEL = ROOT.parent / "voice-control" / "models" / "faster-whisper-small"
VOSK_MODEL = ROOT.parent / "voice-control" / "models" / "vosk-model-small-en-us-0.15"
TORCH_LIB = Path("C:/Users/shrut/AppData/Local/Programs/Python/Python311/Lib/site-packages/torch/lib")


def pcm(x: np.ndarray) -> bytes:
    return syn.to_int16(x).tobytes()


def speech_span(x: np.ndarray, floor_db: float = -42.0) -> tuple[int, int]:
    """Sample range of the speech in a clean clip (frame energy above a floor)."""
    frame = 320
    n = len(x) // frame
    levels = np.sqrt((x[: n * frame].reshape(n, frame) ** 2).mean(axis=1))
    live = np.where(levels > 10 ** (floor_db / 20))[0]
    return (int(live[0]) * frame, int(live[-1] + 1) * frame) if live.size else (0, len(x))


def load_stt(cfg: dict) -> tuple[WhisperSTT, dict]:
    from nlu.command_matcher import load_registry

    prompt, hot = stt_vocabulary(load_registry(settings.COMMANDS_PATH), cfg)
    model = cfg.get("stt_model") or (str(SMALL_MODEL) if SMALL_MODEL.exists() else "small")
    if model.startswith("../"):
        model = str((ROOT / model).resolve())
    lib = cfg.get("stt_cuda_lib_dir") or (str(TORCH_LIB) if TORCH_LIB.exists() else None)
    info = {
        "model": model, "device": cfg.get("stt_device", "cuda"), "compute_type": cfg.get("stt_compute_type", "float16"),
        "hotwords": hot, "initial_prompt": prompt, "cuda_lib_dir": lib,
        "reject_threshold": float(cfg.get("stt_reject_language_threshold", 0.5)),
        "english_floor": float(cfg.get("stt_english_floor", 0.15)),
    }
    stt = WhisperSTT(
        model=info["model"], device=info["device"], compute_type=info["compute_type"], hotwords=info["hotwords"],
        initial_prompt=info["initial_prompt"], cuda_lib_dir=lib, reject_threshold=info["reject_threshold"], english_floor=info["english_floor"],
    )
    info["running_on"] = stt.device
    return stt, info


def make_wake_detector(cfg: dict):
    """The production Vosk wake detector, pointed at the model on disk so it needs no download."""
    import vosk

    real_model = vosk.Model

    def local_model(*_a, **_k):
        return real_model(model_path=str(VOSK_MODEL)) if VOSK_MODEL.exists() else real_model(lang="en-us")

    with umock.patch.object(vosk, "Model", local_model):
        det = VoskWakeWordDetector(
            cfg.get("wake_word_phrase") or "hey travis", settings.SEND_SAMPLE_RATE, cfg.get("wake_word_variants"),
            int(cfg.get("wake_word_partial_confirm_frames", 1)),
        )
    return det


# ═══ STT ═══════════════════════════════════════════════════════════════════
def bench_stt(stt, rng: np.random.Generator, max_refs: int | None = None, only: set[str] | None = None) -> dict:
    """`stt` is anything with transcribe(pcm) -> Transcript (WhisperSTT)."""
    refs = ([c[0] for c in texts.COMMANDS] + texts.CONFUSABLE)[:max_refs]
    babble_src = syn.synth([{"text": s, "voice": "david" if i % 2 else "zira"} for i, s in enumerate(texts.meeting_sentences(2.0, seed=3))])
    babble = np.concatenate([np.concatenate([b, syn.silence(0.3)]) for b in babble_src])

    def clean(i, rate=0):
        return {"text": refs[i], "voice": "david" if i % 2 == 0 else "zira", "rate": rate}

    # (condition name, synth rate, transform)
    conditions = [
        ("clean", 0, lambda x, i: x),
        ("fast", 4, lambda x, i: x),
        ("slow", -4, lambda x, i: x),
        ("white_snr20", 0, lambda x, i: syn.add_noise(x, 20, "white", rng)),
        ("white_snr10", 0, lambda x, i: syn.add_noise(x, 10, "white", rng)),
        ("white_snr5", 0, lambda x, i: syn.add_noise(x, 5, "white", rng)),
        ("pink_snr20", 0, lambda x, i: syn.add_noise(x, 20, "pink", rng)),
        ("pink_snr10", 0, lambda x, i: syn.add_noise(x, 10, "pink", rng)),
        ("pink_snr5", 0, lambda x, i: syn.add_noise(x, 5, "pink", rng)),
        ("hum_snr10", 0, lambda x, i: syn.add_noise(x, 10, "hum", rng)),
        ("distance_1m", 0, lambda x, i: syn.at_distance(x, 1.0, rng)),
        ("distance_3m", 0, lambda x, i: syn.at_distance(x, 3.0, rng)),
        ("distance_5m", 0, lambda x, i: syn.at_distance(x, 5.0, rng)),
        ("babble_sir10", 0, lambda x, i: syn.mix(x, babble[i * 16000 : i * 16000 + len(x) + 8000], 10)),
        ("babble_sir5", 0, lambda x, i: syn.mix(x, babble[i * 16000 : i * 16000 + len(x) + 8000], 5)),
        ("babble_sir0", 0, lambda x, i: syn.mix(x, babble[i * 16000 : i * 16000 + len(x) + 8000], 0)),
    ]
    if only:
        conditions = [c for c in conditions if c[0] in only]
    rows: list[dict] = []
    for cond, rate, fn in conditions:
        audio = syn.synth([clean(i, rate) for i in range(len(refs))])
        for i, x in enumerate(audio):
            y = syn.pad(fn(x, i), 0.25, 0.25)
            tr = stt.transcribe(pcm(y))
            hyp = tr.text
            w, s, d, ins, n = metrics.wer(refs[i], hyp)
            crit = metrics.critical_errors(refs[i], hyp)
            rm = match_command(strip_wake_word(refs[i]), main_registry())
            hm = match_command(strip_wake_word(hyp), main_registry()) if hyp else None
            same = (rm is None and hm is None) or (rm and hm and rm.intent == hm.intent and rm.params == hm.params)
            rows.append({
                "condition": cond, "ref": refs[i], "hyp": hyp, "wer": round(w, 4), "sub": s, "del": d, "ins": ins, "ref_words": n,
                "number_changed": crit["number_changed"], "device_word_lost": crit["device_word_lost"],
                "has_number": bool(metrics.numbers(refs[i])), "command_preserved": bool(same),
                "rejected_language": tr.rejected_language, "no_speech": tr.no_speech, "ms": round(tr.ms), "audio_s": round(len(y) / syn.SR, 2),
            })
    by: dict[str, dict] = {}
    for cond, _, _ in conditions:
        r = [x for x in rows if x["condition"] == cond]
        nums = [x for x in r if x["has_number"]]
        by[cond] = {
            "n": len(r),
            "wer": round(metrics.corpus_wer([(x["ref"], x["hyp"]) for x in r]), 4),
            "exact_transcripts": metrics.rate(sum(1 for x in r if metrics.words(x["ref"]) == metrics.words(x["hyp"])), len(r)),
            "number_changed_rate": metrics.rate(sum(1 for x in nums if x["number_changed"]), len(nums)),
            "device_word_lost_rate": metrics.rate(sum(1 for x in r if x["device_word_lost"]), len(r)),
            "command_preserved_rate": metrics.rate(sum(1 for x in r if x["command_preserved"]), len(r)),
            "wrongly_rejected_as_non_english": sum(1 for x in r if x["rejected_language"]),
            "no_speech_failures": sum(1 for x in r if x["no_speech"] or not x["hyp"]),
        }
    nums_all = [x for x in rows if x["has_number"]]
    return {
        "utterances": len(refs), "clips": len(rows), "by_condition": by,
        "overall": {
            "wer": round(metrics.corpus_wer([(x["ref"], x["hyp"]) for x in rows]), 4),
            "clean_wer": by.get("clean", {}).get("wer"),
            "number_changed_rate": metrics.rate(sum(1 for x in nums_all if x["number_changed"]), len(nums_all)),
            "stt_failures": sum(1 for x in rows if x["no_speech"] or not x["hyp"] or x["rejected_language"]),
            "latency_ms": metrics.latency_summary([x["ms"] for x in rows]),
            "real_time_factor": round(sum(x["ms"] for x in rows) / 1000 / sum(x["audio_s"] for x in rows), 3),
        },
        "worst": sorted(rows, key=lambda x: -x["wer"])[:25],
        "number_errors": [x for x in rows if x["number_changed"]][:40],
        "rows": rows,
    }


_REGISTRY = None


def main_registry():
    global _REGISTRY
    if _REGISTRY is None:
        from nlu.command_matcher import load_registry

        _REGISTRY = load_registry(settings.COMMANDS_PATH)
    return _REGISTRY


# ═══ VAD ═══════════════════════════════════════════════════════════════════
def _stream_vad(ep: Endpointer, audio: np.ndarray) -> list[tuple[bytes, float]]:
    """Feed like the mic does; returns (utterance, audio time it was emitted)."""
    out = []
    for i in range(0, len(audio), CHUNK):
        for u in ep.feed(pcm(audio[i : i + CHUNK])):
            out.append((u, (i + CHUNK) / syn.SR))
    return out


def bench_vad(cfg: dict, rng: np.random.Generator) -> dict:
    def ep():
        return Endpointer(
            sample_rate=syn.SR, aggressiveness=int(cfg.get("vad_aggressiveness", 2)),
            end_ms=int(cfg.get("vad_end_silence_ms", 500)), max_ms=int(cfg.get("vad_max_utterance_ms", 12000)),
        )

    cmds = [c[0] for c in texts.COMMANDS]
    audio = syn.synth([{"text": t, "voice": "david" if i % 2 == 0 else "zira"} for i, t in enumerate(cmds)])
    rows = []
    for t, x in zip(cmds, audio):
        s0, s1 = speech_span(x)
        stream = syn.pad(x, 1.0, 2.5)
        got = _stream_vad(ep(), stream)
        row = {"text": t, "utterances": len(got)}
        if got:
            u, emitted = got[0]
            true_end = 1.0 + s1 / syn.SR
            row.update(
                emit_delay_ms=round((emitted - true_end) * 1000), coverage=round(len(u) / 2 / ((s1 - s0) / syn.SR) / syn.SR, 3),
            )
        rows.append(row)
    one = [r for r in rows if r["utterances"] == 1]

    # a pause in the middle of a command: does it get cut in two?
    halves = [("Travis, set the AC to", "twenty four degrees."), ("Travis, set tusker edge to", "eighty percent."), ("Travis, turn on", "tusker L1.")]
    pause_rows = []
    for a, b in halves:
        xa, xb = syn.synth([{"text": a}, {"text": b, "voice": "zira"}])
        # trim each half to its speech: the synthesiser pads clips with silence, which would add to the pause
        (a0, a1), (b0, b1) = speech_span(xa), speech_span(xb)
        xa, xb = xa[a0:a1], xb[b0:b1]
        for pause_ms in (200, 350, 500, 650, 800, 1200):
            stream = syn.pad(syn.concat([xa, xb], pause_ms / 1000), 0.8, 2.5)
            n = len(_stream_vad(ep(), stream))
            pause_rows.append({"command": f"{a} … {b}", "pause_ms": pause_ms, "utterances": n, "split": n > 1})
    by_pause = {}
    for p in sorted({r["pause_ms"] for r in pause_rows}):
        rr = [r for r in pause_rows if r["pause_ms"] == p]
        by_pause[p] = metrics.rate(sum(r["split"] for r in rr), len(rr))

    # non-speech: should never become an utterance
    noise_rows = []
    for kind, level_db in (("white", -40), ("pink", -35), ("hum", -35), ("white", -28), ("pink", -25)):
        secs = 120
        n = syn.noise(kind, secs * syn.SR, rng) * 10 ** (level_db / 20)
        got = _stream_vad(ep(), n.astype(np.float32))
        noise_rows.append({"kind": kind, "level_dbfs": level_db, "seconds": secs, "false_utterances": len(got)})
    return {
        "config": {"aggressiveness": int(cfg.get("vad_aggressiveness", 2)), "end_silence_ms": int(cfg.get("vad_end_silence_ms", 500))},
        "clean_commands": {
            "n": len(rows), "exactly_one_utterance": metrics.rate(len(one), len(rows)),
            "emit_delay_ms": metrics.latency_summary([r["emit_delay_ms"] for r in one]),
            "utterance_counts": {str(k): sum(1 for r in rows if r["utterances"] == k) for k in sorted({r["utterances"] for r in rows})},
            "split_commands": [r["text"] for r in rows if r["utterances"] > 1],
            "length_vs_speech_mean": round(sum(r["coverage"] for r in one) / max(1, len(one)), 3),
            "length_vs_speech_min": min((r["coverage"] for r in one), default=None),
        },
        "split_rate_by_mid_command_pause_ms": by_pause,
        "noise_only": noise_rows,
        "rows": rows, "pause_rows": pause_rows,
    }


# ═══ mic loop simulation ═══════════════════════════════════════════════════
class MicSim:
    """TravisBase._listen_audio + TravisLocal._utterance_loop, driven by a recording."""

    def __init__(self, detector, agent: BenchAgent, mock: MockCms, cfg: dict):
        self.det, self.agent, self.mock = detector, agent, mock
        self.cfg = cfg
        self.awake_timeout = float(cfg.get("awake_timeout_sec", 8.0))
        self.debounce = 2.0

    def _endpointer(self) -> Endpointer:
        return Endpointer(
            sample_rate=syn.SR, aggressiveness=int(self.cfg.get("vad_aggressiveness", 2)),
            end_ms=int(self.cfg.get("vad_end_silence_ms", 500)), max_ms=int(self.cfg.get("vad_max_utterance_ms", 12000)),
        )

    async def run(self, audio: np.ndarray) -> list[dict]:
        """One entry per wake event: when it fired, what was heard, and what happened."""
        det, ep = self.det, self._endpointer()
        det._rec.Reset()
        preroll: deque[bytes] = deque(maxlen=16)
        awake, awake_until, last_wake = False, 0.0, -99.0
        events: list[dict] = []
        cur: dict | None = None

        async def handle(utt: bytes, now: float):
            nonlocal awake, cur
            mark = self.mock.snapshot()
            trace = await self.agent.run_audio(utt)
            calls = self.mock.calls_since(mark)
            if cur is not None:
                cur["utterances"].append({
                    "t": round(now, 2), "transcript": trace.transcript, "language": trace.language, "path": trace.path,
                    "gate": trace.gate, "reply": trace.reply, "stt_ms": trace.stt_ms, "error": trace.error,
                    "calls": calls, "trace": trace, "emitted_at": now,
                })
            if trace.path or trace.said or not self.agent._awake:
                awake = False  # exchange finished (or a false wake went back to standby)
            self.agent._awake = True

        for i in range(0, len(audio), CHUNK):
            chunk = pcm(audio[i : i + CHUNK])
            t = (i + CHUNK) / syn.SR
            preroll.append(chunk)
            fired = det.detect(chunk)
            if fired and t - last_wake >= self.debounce:
                last_wake = t
                if not awake:
                    awake = True
                    ep.reset()
                    self.agent.begin_wake()
                    cur = {"t_wake": round(t, 2), "utterances": []}
                    events.append(cur)
                    for pre in list(preroll):  # production flushes the 1 s pre-roll into the VAD on a fresh wake
                        for u in ep.feed(pre):
                            await handle(u, t)
                    awake_until = t + self.awake_timeout
                    continue
                awake_until = t + self.awake_timeout
            if awake:
                for u in ep.feed(chunk):
                    await handle(u, t)
                if awake and t >= awake_until:
                    awake = False
        return events


def _actions(calls: list[dict]) -> list[canon.Action]:
    return [a for c in calls if c["method"] == "POST" and c.get("status") and c["status"] < 300 for a in canon.canon_call(c)]


# ═══ wake word at the detector level + false activations per hour ═════════
def build_meeting_stream(sentences: list[str], rng: np.random.Generator, voices_rate_jitter: bool = True):
    items = [
        {"text": s, "voice": "david" if i % 2 == 0 else "zira", "rate": int(rng.integers(-2, 3)) if voices_rate_jitter else 0}
        for i, s in enumerate(sentences)
    ]
    clips = syn.synth(items)
    parts, spans, pos = [], [], 0
    for s, c in zip(sentences, clips):
        gap = syn.silence(float(rng.uniform(0.3, 1.5)))
        spans.append((pos, pos + len(c), s))
        parts += [c, gap]
        pos += len(c) + len(gap)
    return np.concatenate(parts), spans


def detect_only(det, audio: np.ndarray, debounce: float = 2.0) -> list[float]:
    det._rec.Reset()
    events, last = [], -99.0
    for i in range(0, len(audio), CHUNK):
        t = (i + CHUNK) / syn.SR
        if det.detect(pcm(audio[i : i + CHUNK])) and t - last >= debounce:
            events.append(round(t, 2))
            last = t
    return events


def bench_wake(det, rng: np.random.Generator) -> dict:
    cmds = [c[0] for c in texts.COMMANDS]
    conds = [("clean", lambda x: x), ("white_snr10", lambda x: syn.add_noise(x, 10, "white", rng)),
             ("pink_snr5", lambda x: syn.add_noise(x, 5, "pink", rng)), ("distance_3m", lambda x: syn.at_distance(x, 3.0, rng))]
    pos_rows = []
    for voice in ("david", "zira"):
        audio = syn.synth([{"text": t, "voice": voice} for t in cmds])
        for t, x in zip(cmds, audio):
            for cname, fn in conds:
                ev = detect_only(det, syn.pad(fn(x), 1.0, 2.5))
                pos_rows.append({"text": t, "voice": voice, "condition": cname, "fires": len(ev), "first_fire_s": ev[0] if ev else None})
    by_cond = {}
    for cname, _ in conds:
        r = [x for x in pos_rows if x["condition"] == cname]
        by_cond[cname] = {"n": len(r), "activated": metrics.rate(sum(1 for x in r if x["fires"] >= 1), len(r)),
                          "missed": sum(1 for x in r if x["fires"] == 0), "fired_more_than_once": sum(1 for x in r if x["fires"] > 1)}
    variants = {k: [x for x in pos_rows if x["condition"] == "clean" and x["text"].lower().startswith(k)] for k in ("hey", "okay", "hi", "travis")}

    def run_set(sentences: list[str]):
        rows = []
        for voice in ("david", "zira"):
            audio = syn.synth([{"text": t, "voice": voice} for t in sentences])
            for t, x in zip(sentences, audio):
                rows.append({"text": t, "voice": voice, "fires": len(detect_only(det, syn.pad(x, 1.0, 2.0)))})
        return rows

    no_hey = run_set(texts.NO_HEY)
    mentions = run_set(texts.MENTIONS)
    near = run_set(texts.NEAR_MISS)
    return {
        "positives": {"n": len(pos_rows), "activated": metrics.rate(sum(1 for x in pos_rows if x["fires"] >= 1), len(pos_rows)),
                      "missed": sum(1 for x in pos_rows if x["fires"] == 0), "by_condition": by_cond,
                      "by_prefix": {k: {"n": len(v), "activated": metrics.rate(sum(1 for x in v if x["fires"] >= 1), len(v))} for k, v in variants.items() if v}},
        "name_without_hey": {"n": len(no_hey), "woke": sum(1 for x in no_hey if x["fires"] >= 1), "rows": no_hey,
                             "note": "'Travis, ...' without 'hey' is not the wake phrase: it should not wake"},
        "mentions_not_addressed": {"n": len(mentions), "woke": sum(1 for x in mentions if x["fires"] >= 1), "rows": mentions,
                                   "note": "the word 'Travis' is in these sentences, so a keyword detector wakes; whether anything then executes is judged in the transcript and end-to-end tests"},
        "near_miss_words": {"n": len(near), "woke": sum(1 for x in near if x["fires"] >= 1), "rows": near},
        "missed_rows": [x for x in pos_rows if x["fires"] == 0][:30],
        "rows": pos_rows,
    }


# ═══ end-to-end scenarios ══════════════════════════════════════════════════
def _expected_alts(entry) -> list[list[canon.Action]]:
    _, exp, alts = entry
    return alts if alts else [exp]


def _score_events(events: list[dict], alts, expect_nothing: bool = False) -> dict:
    calls = [c for e in events for u in e["utterances"] for c in u["calls"]]
    acts = _actions(calls)
    if expect_nothing:
        return {"executed": acts, "exact": not acts, "spoke": any(u["reply"] for e in events for u in e["utterances"])}
    m, _ = canon.best_compare(alts, acts)
    return {"executed": acts, "exact": m.exact, "partial": m.partial, "extra": m.extra, "missing": m.missing,
            "duplicates": m.duplicates, "spoke": any(u["reply"] for e in events for u in e["utterances"])}


def _lat(events: list[dict], speech_end_s: float | None) -> dict | None:
    """Speech end -> first spoken word, split into its stages (TTS excluded)."""
    for e in events:
        for u in e["utterances"]:
            tr = u["trace"]
            if tr.said and speech_end_s is not None:
                first = (tr.said[0][0] - tr.t0) * 1000
                vad = (u["emitted_at"] - speech_end_s) * 1000
                tool_ms = sum((t["end"] - t["start"]) * 1000 for t in tr.tools)
                gate = (tr.gate or {}).get("ms") or 0
                llm = ((tr.llm_end - tr.llm_start) * 1000 - tool_ms) if tr.llm_start and tr.llm_end else 0
                stt = tr.stt_ms or 0
                return {"total_ms": round(vad + first), "vad_end_silence_ms": round(vad), "stt_ms": round(stt), "gate_ms": round(gate),
                        "llm_ms": round(llm), "cms_ms": round(tool_ms), "other_ms": round(first - stt - gate - llm - tool_ms),
                        "path": tr.path or ("decline" if tr.gate and not tr.gate.get("allowed") else "none")}
    return None


async def bench_e2e(stt, det, cfg: dict, rng: np.random.Generator, cms_latency_ms: float, minutes: float) -> dict:
    mock = MockCms(latency_ms=cms_latency_ms).start()
    out: dict = {"scenarios": {}, "meeting_false_activation": {}}
    with bench_env(mock):
        agent = BenchAgent()
        agent._stt = stt
        await agent._llm.warm([{"role": "system", "content": agent._system_prompt}], agent._llm_tools)
        sim = MicSim(det, agent, mock, cfg)

        async def run_scenario(name: str, build, entries=None, expect_nothing=False, items=None):
            rows = []
            for idx, entry in enumerate(entries if entries is not None else items):
                agent.reset_context()
                mock.reset(fixtures=Fixtures.fresh())
                audio, speech_end = build(idx, entry)
                events = await sim.run(audio)
                score = _score_events(events, None if expect_nothing else _expected_alts(entry), expect_nothing)
                row = {"text": entry if isinstance(entry, str) else entry[0], "wake_events": len(events),
                       "heard": [u["transcript"] for e in events for u in e["utterances"]],
                       "replies": [u["reply"] for e in events for u in e["utterances"] if u["reply"]],
                       **{k: v for k, v in score.items()}}
                lat = _lat(events, speech_end)
                if lat:
                    row["latency"] = lat
                rows.append(row)
            out["scenarios"][name] = _summarize(rows, expect_nothing)
            out["scenarios"][name]["rows"] = rows
            print(f"[audio] e2e {name}: {out['scenarios'][name]['summary_line']}", flush=True)

        cmds = texts.COMMANDS
        voices = ["david", "zira"]
        clips = {(i, v): syn.synth([{"text": cmds[i][0], "voice": v}])[0] for i in range(len(cmds)) for v in voices}
        chatter_sent = texts.meeting_sentences(3.0, seed=11)
        chatter_clips = syn.synth([{"text": s, "voice": "david" if k % 2 == 0 else "zira"} for k, s in enumerate(chatter_sent)])
        chat = lambda a, b: np.concatenate([np.concatenate([c, syn.silence(0.6)]) for c in chatter_clips[a:b]])  # noqa: E731

        def solo(idx, entry, voice=None, fn=lambda x: x):
            i = idx % len(cmds)
            x = clips[(i, voice or voices[idx % 2])]
            _, end = speech_span(x)
            return syn.pad(fn(x), 1.0, 3.0), 1.0 + end / syn.SR

        await run_scenario("solo_clean", lambda i, e: solo(i, e), entries=[(c[0], c[1], c[2]) for c in cmds] * 2)
        await run_scenario("solo_pink_snr10", lambda i, e: solo(i, e, fn=lambda x: syn.add_noise(x, 10, "pink", rng)), entries=cmds)
        await run_scenario("solo_distance_3m", lambda i, e: solo(i, e, fn=lambda x: syn.at_distance(x, 3.0, rng)), entries=cmds)

        def in_meeting(idx, entry):
            i = idx % len(cmds)
            x = clips[(i, voices[idx % 2])]
            _, end = speech_span(x)
            pre = chat(idx % 20, idx % 20 + 5)
            stream = np.concatenate([pre, syn.silence(1.0), x, syn.silence(3.0), chat(idx % 20 + 5, idx % 20 + 8)])
            return stream, (len(pre) + syn.SR + end) / syn.SR

        await run_scenario("command_inside_meeting_talk", in_meeting, entries=cmds)

        def overlapped(sir):
            def build(idx, entry):
                x = clips[(idx % len(cmds), voices[idx % 2])]
                _, end = speech_span(x)
                bed = np.concatenate([np.concatenate([c, syn.silence(0.2)]) for c in chatter_clips[(idx * 3) % 20 : (idx * 3) % 20 + 6]])
                mixed = syn.mix(syn.pad(x, 1.0, 3.0), bed, sir, offset_s=0.0)
                return mixed, 1.0 + end / syn.SR
            return build

        for sir in (10, 5, 0):
            await run_scenario(f"command_over_other_speaker_sir{sir}", overlapped(sir), entries=cmds)

        def mention_in_meeting(idx, entry):
            x = syn.synth([{"text": entry, "voice": voices[idx % 2]}])[0]
            return np.concatenate([chat(idx % 15, idx % 15 + 4), syn.silence(0.8), x, syn.silence(2.5), chat(idx % 15 + 4, idx % 15 + 6)]), None

        await run_scenario("mention_not_addressed", mention_in_meeting, entries=texts.MENTIONS, expect_nothing=True)

        def background_travis(idx, entry):
            """Someone else, quietly in the background, says a command to Travis while the room talks."""
            x = clips[(idx % len(cmds), "david")]
            bed = chat(idx % 10, idx % 10 + 8)
            offset = max(0.0, len(bed) / syn.SR - len(x) / syn.SR - 1.0)
            mixed = syn.mix(bed, x, 10, offset_s=offset)  # the command sits 10 dB under the room talk
            return syn.pad(mixed, 0.5, 3.0), None

        # (expect nothing is wrong here by design: with no speaker gate any voice can address Travis; reported as an observation)
        await run_scenario("other_speaker_addresses_travis_while_room_talks", background_travis, entries=cmds[:8], expect_nothing=True)

        # ── false activations: a long stretch of meeting talk, no wake word ──
        rng2 = np.random.default_rng(99)
        sentences = texts.meeting_sentences(minutes, seed=5)
        stream, spans = build_meeting_stream(sentences, rng2)
        agent.reset_context()
        mock.reset(fixtures=Fixtures.fresh())
        started = time.perf_counter()
        events = await sim.run(stream)
        elapsed = time.perf_counter() - started
        hours = len(stream) / syn.SR / 3600
        fx = []
        for e in events:
            where = next((s for a, b, s in spans if a / syn.SR <= e["t_wake"] <= b / syn.SR + 3), "?")
            fx.append({"t_wake": e["t_wake"], "sentence": where, "heard": [u["transcript"] for u in e["utterances"]],
                       "replies": [u["reply"] for u in e["utterances"] if u["reply"]], "actions": _actions([c for u in e["utterances"] for c in u["calls"]])})
        actuations = [a for r in fx for a in r["actions"]]
        out["meeting_false_activation"] = {
            "audio_minutes": round(len(stream) / syn.SR / 60, 1), "sentences": len(sentences), "wake_events": len(events),
            "wakes_per_hour": round(len(events) / hours, 2), "wakes_per_hour_upper95": round(metrics.poisson_upper_95(len(events), hours), 2),
            "spoken_responses": sum(1 for r in fx if r["replies"]), "actions_executed": len(actuations), "actions": actuations,
            "events": fx, "processing_seconds": round(elapsed, 1),
            "caveat": "synthetic speech from two SAPI voices; real meetings have more voices, overlap, laughter and accents, so treat this as a floor, not a field measurement",
        }
        print(f"[audio] false activations: {len(events)} wake(s) in {out['meeting_false_activation']['audio_minutes']} min of meeting talk", flush=True)
    mock.stop()
    return out


def _summarize(rows: list[dict], expect_nothing: bool) -> dict:
    n = len(rows)
    lat = [r["latency"]["total_ms"] for r in rows if r.get("latency")]
    if expect_nothing:
        acted = sum(1 for r in rows if r["executed"])
        woke = sum(1 for r in rows if r["wake_events"])
        spoke = sum(1 for r in rows if r["spoke"])
        return {"n": n, "actuated": acted, "woke": woke, "spoke": spoke,
                "summary_line": f"{n} cases: woke {woke}, spoke {spoke}, executed an action {acted}"}
    exact = sum(1 for r in rows if r["exact"])
    woke = sum(1 for r in rows if r["wake_events"])
    partial = sum(r.get("partial", 0) for r in rows) / n if n else 0
    return {"n": n, "exact": exact, "exact_rate": metrics.rate(exact, n), "partial_rate": round(partial, 3), "missed_wake": n - woke,
            "extra_actions": sum(len(r.get("extra", [])) for r in rows), "latency_ms": metrics.latency_summary(lat),
            "summary_line": f"{exact}/{n} exact, {n - woke} missed wake, p50 speech-end->reply {metrics.latency_summary(lat).get('p50')}ms"}


# ═══ optional: ElevenLabs time to first audio ═════════════════════════════
async def measure_tts(cfg: dict, n: int = 5) -> dict:
    from speech.elevenlabs_stream import ElevenLabsStreamer

    key, voice = cfg.get("elevenlabs_api_key", "").strip(), cfg.get("elevenlabs_voice_id", "").strip()
    if not (key and voice):
        return {"measured": False, "reason": "no elevenlabs_api_key / elevenlabs_voice_id in config"}
    rows = []
    for k in range(n):
        q: asyncio.Queue = asyncio.Queue()
        el = ElevenLabsStreamer(key, voice, cfg.get("elevenlabs_model_id", "eleven_flash_v2_5"), 24000, q)
        t0 = time.perf_counter()
        await el.prewarm()
        t1 = time.perf_counter()
        await el.send_text("Tusker edge is on. ")
        await el.flush()
        try:
            await asyncio.wait_for(q.get(), 8.0)
            rows.append({"connect_ms": round((t1 - t0) * 1000), "first_audio_after_text_ms": round((time.perf_counter() - t1) * 1000)})
        except asyncio.TimeoutError:
            rows.append({"connect_ms": round((t1 - t0) * 1000), "first_audio_after_text_ms": None})
        await el.cancel()
    ok = [r["first_audio_after_text_ms"] for r in rows if r["first_audio_after_text_ms"] is not None]
    return {"measured": True, "samples": rows, "first_audio_after_text_ms": metrics.latency_summary(ok),
            "note": "text -> first audio chunk with the session pre-warmed (as it is on every wake word)"}


# ═══ entry point ═══════════════════════════════════════════════════════════
async def run_audio(out_dir: Path, minutes: float, cms_latency_ms: float, live_tts: bool, sections: set[str] | None = None) -> dict:
    """sections: any of stt, vad, wake, e2e (default all). A partial run is merged into an existing audio_results.json."""
    sections = sections or {"stt", "vad", "wake", "e2e"}
    out_dir.mkdir(parents=True, exist_ok=True)
    prior = out_dir / "audio_results.json"
    cfg = settings.load_api_config()
    rng = np.random.default_rng(1234)
    stt, stt_info = load_stt(cfg)
    try:
        from audio import speaker

        speaker_gate = {"installed": bool(speaker.available()), "enabled_in_config": bool(cfg.get("speaker_extraction_enabled", cfg.get("speaker_gate_enabled", False)))}
    except Exception as e:
        speaker_gate = {"installed": False, "enabled_in_config": bool(cfg.get("speaker_extraction_enabled", False)), "error": str(e)}
    result: dict = {
        "environment": {"python": platform.python_version(), "stt": stt_info, "speaker_gate": speaker_gate,
                        "voices": "Windows SAPI: Microsoft David, Microsoft Zira (US English, synthetic)",
                        "wake_word": {"engine": cfg.get("wake_word_engine"), "phrase": cfg.get("wake_word_phrase", "hey travis"),
                                      "partial_confirm_frames": cfg.get("wake_word_partial_confirm_frames", 1), "model": str(VOSK_MODEL) if VOSK_MODEL.exists() else "vosk en-us (download)"},
                        "cms_latency_ms_added": cms_latency_ms},
    }
    if prior.exists() and sections != {"stt", "vad", "wake", "e2e"}:
        old_result = json.loads(prior.read_text(encoding="utf-8"))
        result = {**old_result, "environment": result["environment"]}
    if "stt" in sections:
        print("[audio] STT / WER ...", flush=True)
        result["stt"] = bench_stt(stt, rng)
        print(f"[audio] STT: overall WER {result['stt']['overall']['wer']:.1%}, clean {result['stt']['overall']['clean_wer']:.1%}", flush=True)
    if "vad" in sections:
        print("[audio] VAD ...", flush=True)
        result["vad"] = bench_vad(cfg, rng)
    det = make_wake_detector(cfg)
    if "wake" in sections:
        print("[audio] wake word ...", flush=True)
        result["wake"] = bench_wake(det, rng)
        print(f"[audio] wake: {result['wake']['positives']['activated']:.0%} of {result['wake']['positives']['n']} positives", flush=True)
    if "e2e" in sections:
        print("[audio] end-to-end scenarios ...", flush=True)
        result["e2e"] = await bench_e2e(stt, det, cfg, rng, cms_latency_ms, minutes)
    result["tts"] = await measure_tts(cfg) if live_tts else {"measured": False, "reason": "not run (add --live-tts; it uses your ElevenLabs credits)"}

    def strip(o):
        """Drop heavy trace objects before writing JSON."""
        if isinstance(o, dict):
            return {k: strip(v) for k, v in o.items() if k not in ("trace", "calls")}
        if isinstance(o, list):
            return [strip(v) for v in o]
        return o

    (out_dir / "audio_results.json").write_text(json.dumps(strip(result), indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    return result
