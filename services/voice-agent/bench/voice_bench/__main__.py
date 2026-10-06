"""CLI: python -m bench.voice_bench {text,audio,all,report,record,score}"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

RESULTS = ROOT / "bench" / "results"


def latest_run() -> Path | None:
    runs = sorted(p for p in RESULTS.glob("*") if p.is_dir())
    return runs[-1] if runs else None


def main() -> int:
    ap = argparse.ArgumentParser(prog="bench.voice_bench", description=__doc__)
    ap.add_argument("command", choices=["text", "audio", "all", "report", "record", "score", "review"])
    ap.add_argument("--out", help="results folder (default: bench/results/<timestamp>)")
    ap.add_argument("--category", action="append", help="only these categories (repeatable)")
    ap.add_argument("--id", help="only cases whose id contains this")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--repeats", type=int, default=1, help="run each case N times (the LLM is not deterministic)")
    ap.add_argument("--cms-latency-ms", type=float, default=0.0, help="delay added to every mock CMS command")
    ap.add_argument("--llm-temperature", type=float, help="override Qwen's temperature (default: production's)")
    ap.add_argument("--audio-minutes", type=float, default=12.0, help="meeting speech for the false-activation estimate")
    ap.add_argument("--session", help="recorded-clips session folder name (record/score)")
    ap.add_argument("--sections", default="stt,vad,wake,e2e", help="audio sections to run, comma separated (merged into an existing audio_results.json)")
    ap.add_argument("--live-tts", action="store_true", help="also time ElevenLabs first audio (uses your ElevenLabs credits)")
    args = ap.parse_args()

    if args.command == "review":
        from agent import exchange_log

        rows = exchange_log.read(ROOT / "logs" / "exchanges.jsonl", args.limit or 20)
        print("\n\n".join(exchange_log.format_row(r) for r in rows) if rows else "No exchanges logged yet (logs/exchanges.jsonl).")
        return 0
    if args.command == "record":
        from . import record_clips

        return record_clips.record(args.session)
    if args.command == "score":
        from . import record_clips

        return record_clips.score(args.session, latest_run() or RESULTS)

    out = Path(args.out) if args.out else (latest_run() if args.command == "report" else RESULTS / __import__("time").strftime("%Y%m%d-%H%M%S"))
    out.mkdir(parents=True, exist_ok=True)

    if args.command in ("text", "all"):
        from .runner_text import run_text, select_cases

        selected = select_cases(args.category, args.id, args.limit)
        asyncio.run(run_text(selected, out, args.repeats, args.cms_latency_ms, args.llm_temperature))
    if args.command in ("audio", "all"):
        from . import audio_bench

        asyncio.run(audio_bench.run_audio(out, args.audio_minutes, args.cms_latency_ms, args.live_tts, set(args.sections.split(','))))
    from . import report

    path = report.build(out)
    print(f"\n[bench] report: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
