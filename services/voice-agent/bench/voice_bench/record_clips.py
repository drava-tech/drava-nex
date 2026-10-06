"""Record real clips, then score them with the same pipeline as the synthetic ones.

    python -m bench.voice_bench record --session mine      # you speak the prompts it shows
    python -m bench.voice_bench score  --session mine      # WER, wake word, end-to-end result per clip

Synthetic voices can't stand in for your accent, your room or other people, so
this is how those cases get measured. Clips are 16 kHz mono WAVs under
bench/recordings/<session>/ with a manifest.json (gitignored: they're your voice).
Use the mic and speaker you actually run TRAVIS with (mic_device_name in
config/api_keys.json is used).
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RECORDINGS = ROOT / "bench" / "recordings"
SECONDS = 7.0

# (condition, how to say it, which of audio_texts.COMMANDS it is; None = not addressed to Travis)
CONDITIONS = {
    "normal": "speak normally, at your usual distance",
    "fast": "speak quickly",
    "slow": "speak slowly and deliberately",
    "far": "stand or sit about 3 metres from the mic",
    "noisy": "with background noise (fan, TV, music) playing",
    "overlap": "while another person keeps talking nearby (they should NOT say Travis)",
    "second_speaker": "have a DIFFERENT person say this one",
}


def prompts() -> list[dict]:
    from . import audio_texts as texts

    out: list[dict] = []
    for i, c in enumerate(texts.COMMANDS):
        out.append({"id": f"cmd{i:02d}_normal", "text": c[0], "condition": "normal", "command": i})
    plan = {"fast": [0, 2, 5, 11], "slow": [3, 6, 9, 13], "far": [1, 4, 7, 10, 12, 14], "noisy": [0, 3, 5, 8, 11, 15],
            "overlap": [2, 4, 6, 8], "second_speaker": [1, 5, 9, 12]}
    for cond, idxs in plan.items():
        for i in idxs:
            out.append({"id": f"cmd{i:02d}_{cond}", "text": texts.COMMANDS[i][0], "condition": cond, "command": i})
    for k, s in enumerate(texts.MENTIONS[:6]):
        out.append({"id": f"mention{k:02d}", "text": s, "condition": "mention (not addressed)", "command": None})
    for k, s in enumerate(texts.MEETING_HANDCRAFTED[:6]):
        out.append({"id": f"meeting{k:02d}", "text": s, "condition": "meeting talk (not addressed)", "command": None})
    return out


def _device():
    import settings
    from audio.devices import resolve_input_device

    cfg = settings.load_api_config()
    return resolve_input_device(cfg.get("mic_device_name", ""))


def record(session: str | None) -> int:
    import sounddevice as sd

    from . import audio_synth as syn

    session = session or time.strftime("%Y%m%d-%H%M")
    folder = RECORDINGS / session
    folder.mkdir(parents=True, exist_ok=True)
    manifest_path = folder / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"clips": {}}
    who = input("Who is speaking (a short label, e.g. your name + accent)? ").strip() or "speaker1"
    device = _device()
    todo = [p for p in prompts() if p["id"] not in manifest["clips"]]
    print(f"\n{len(todo)} prompts to record into {folder}. Each lasts {SECONDS:.0f} s.\n"
          "Enter = record, s = skip, r = redo the last one, q = stop (progress is saved).\n")
    last = None
    i = 0
    while i < len(todo):
        p = todo[i]
        print(f"[{i + 1}/{len(todo)}] ({p['condition']}: {CONDITIONS.get(p['condition'], 'say it as written')})")
        print(f'    SAY: "{p["text"]}"')
        cmd = input("    > ").strip().lower()
        if cmd == "q":
            break
        if cmd == "s":
            i += 1
            continue
        if cmd == "r" and last:
            todo.insert(i, last)
            cmd = ""
        print("    recording…", flush=True)
        audio = sd.rec(int(SECONDS * syn.SR), samplerate=syn.SR, channels=1, dtype="int16", device=device)
        sd.wait()
        x = audio[:, 0].astype(np.float32) / 32768.0
        peak = float(np.abs(x).max())
        syn.write_wav(folder / f"{p['id']}.wav", x)
        manifest["clips"][p["id"]] = {**p, "speaker": who, "peak": round(peak, 3), "file": f"{p['id']}.wav"}
        manifest_path.write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"    saved (peak {peak:.2f}{' — very quiet, consider redoing' if peak < 0.03 else ''}{' — clipped' if peak > 0.98 else ''})")
        last = p
        i += 1
    print(f"\nDone. Score with:  python -m bench.voice_bench score --session {session}")
    return 0


def score(session: str | None, run_dir: Path) -> int:
    from . import audio_bench, audio_synth as syn, metrics
    from . import audio_texts as texts
    from .agent import BenchAgent, bench_env
    from .mock_cms import MockCms
    from .names import Fixtures
    import settings

    sessions = sorted(p for p in RECORDINGS.glob("*") if (p / "manifest.json").exists())
    if not sessions:
        print("No recordings yet. Run:  python -m bench.voice_bench record")
        return 1
    folder = RECORDINGS / session if session else sessions[-1]
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    cfg = settings.load_api_config()
    stt, _ = audio_bench.load_stt(cfg)
    det = audio_bench.make_wake_detector(cfg)

    async def go() -> list[dict]:
        mock = MockCms().start()
        rows: list[dict] = []
        with bench_env(mock):
            agent = BenchAgent()
            agent._stt = stt
            await agent._llm.warm([{"role": "system", "content": agent._system_prompt}], agent._llm_tools)
            sim = audio_bench.MicSim(det, agent, mock, cfg)
            for cid, meta in manifest["clips"].items():
                x = syn.read_wav(folder / meta["file"])
                tr = stt.transcribe(audio_bench.pcm(x))
                ref = meta["text"]
                w, s, d, ins, n = metrics.wer(ref, tr.text)
                crit = metrics.critical_errors(ref, tr.text)
                agent.reset_context()
                mock.reset(fixtures=Fixtures.fresh())
                events = await sim.run(syn.pad(x, 0.5, 2.0))
                acts = audio_bench._actions([c for e in events for u in e["utterances"] for c in u["calls"]])
                row = {"id": cid, "condition": meta["condition"], "speaker": meta.get("speaker"), "text": ref, "heard": tr.text, "wer": round(w, 4),
                       "number_changed": crit["number_changed"], "language": tr.language, "rejected": tr.rejected_language,
                       "woke": bool(events), "actions": acts, "replies": [u["reply"] for e in events for u in e["utterances"] if u["reply"]]}
                if meta["command"] is not None:
                    _, exp, alts = texts.COMMANDS[meta["command"]]
                    from . import canon

                    m, _ = canon.best_compare(alts or [exp], acts)
                    row.update(expected_command=meta["command"], exact=m.exact, extra=m.extra, missing=m.missing)
                else:
                    row.update(expected_command=None, exact=not acts)
                rows.append(row)
                print(f"[clip] {cid:<26} WER {w:5.1%}  woke={row['woke']!s:<5} exact={row['exact']}", flush=True)
        mock.stop()
        return rows

    rows = asyncio.run(go())
    by: dict[str, dict] = {}
    for cond in sorted({r["condition"] for r in rows}):
        rr = [r for r in rows if r["condition"] == cond]
        addressed = [r for r in rr if r["expected_command"] is not None]
        by[cond] = {
            "clips": len(rr), "wer": round(metrics.corpus_wer([(r["text"], r["heard"]) for r in rr]), 4),
            "numbers_changed": sum(1 for r in rr if r["number_changed"]),
            "woke": sum(1 for r in addressed if r["woke"]), "addressed": len(addressed),
            "exact": sum(1 for r in rr if r["exact"]), "wrongly_rejected_non_english": sum(1 for r in rr if r["rejected"]),
            "acted_when_not_addressed": sum(1 for r in rr if r["expected_command"] is None and r["actions"]),
        }
    summary = {"session": folder.name, "clips": len(rows), "overall_wer": round(metrics.corpus_wer([(r["text"], r["heard"]) for r in rows]), 4), "by_condition": by}
    (run_dir / "recorded_results.json").write_text(json.dumps({"summary": summary, "rows": rows}, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    print("\n" + json.dumps(summary, indent=1))
    from . import report

    print(f"\nreport: {report.build(run_dir)}")
    return 0


if __name__ == "__main__":
    sys.exit(record(None))
