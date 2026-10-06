"""A record of every spoken exchange, for reviewing real-voice testing.

One JSON line per thing TRAVIS heard: what Whisper wrote, why it was ignored (not English,
false wake, noise...) or which path handled it (command list / several actions / model /
declined), every tool call with its result, what was said back, and the speech-end ->
first-word time. Read it with `python -m bench.voice_bench review`.

Never raises: a logging problem must not interrupt a command.
"""

from __future__ import annotations

import json
import time
from pathlib import Path


class ExchangeLog:
    def __init__(self, path: Path):
        self.path = path

    def write(self, record: dict) -> None:
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            record = {"t": time.strftime("%Y-%m-%d %H:%M:%S"), **record}
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
        except Exception:
            pass


def read(path: Path, last: int = 20) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    return rows[-last:]


def format_row(r: dict) -> str:
    if r.get("ignored"):
        return f"{r['t']}  IGNORED ({r['ignored']})  heard: {r.get('text')!r}"
    calls = "; ".join(
        f"{c['name']}:{c.get('args', {}).get('action')}"
        + (f"[{c['args'].get('target') or c['args'].get('screen') or ''}]" if (c.get("args") or {}).get("target") or (c.get("args") or {}).get("screen") else "")
        + ("" if c.get("ok") else (" NOT SENT" if c.get("rejected") else " FAILED"))
        for c in r.get("calls", [])
    ) or "no tool calls"
    ms = r.get("speech_end_to_first_word_ms")
    return (
        f"{r['t']}  [{r.get('path')}]  heard: {r.get('heard', {}).get('text')!r}\n"
        f"    command: {r.get('command')!r}\n"
        f"    actions: {calls}\n"
        f"    said:    {r.get('reply')!r}" + (f"   ({ms:.0f} ms from end of speech to first word)" if ms else "")
    )
