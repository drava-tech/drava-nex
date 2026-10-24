"""Runs the text-level cases through the production TravisLocal against the mock CMS."""

from __future__ import annotations

import json
import socket
import threading
import time
from pathlib import Path

from actions import cms_client
from nlu.relevance import gate_messages

from . import cases as case_mod
from .agent import BenchAgent, bench_env
from .judge import evaluate
from .mock_cms import MockCms
from .names import Fixtures

PRESETS = {
    "main_welcome": lambda f: f.screens["main-screen"].update(experienceName="Welcome Experience"),
    "main_presentation": lambda f: f.screens["main-screen"].update(mediaName="Company Presentation"),
    "ac_23": lambda f: f.devices["dev-ac"].update(power=True, temp=23),
    "edge_60": lambda f: f.devices["dev-edge"].update(on=True, brightness=60),
}


class HangServer:
    """Accepts connections and never answers: an LLM that stopped responding."""

    def __init__(self):
        self._sock = socket.socket()
        self._sock.bind(("127.0.0.1", 0))
        self._sock.listen(8)
        self.port = self._sock.getsockname()[1]
        self._conns: list[socket.socket] = []
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while True:
            try:
                conn, _ = self._sock.accept()
            except OSError:
                return
            self._conns.append(conn)

    def close(self):
        self._sock.close()
        for c in self._conns:
            c.close()


async def run_text(
    selected: list[case_mod.Case],
    out_dir: Path,
    repeats: int = 1,
    cms_latency_ms: float = 0.0,
    llm_temperature: float | None = None,
    quiet: bool = False,
) -> list[dict]:
    from agent import fallback_stats

    fallback_stats.reset()
    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[dict] = []
    mock = MockCms(latency_ms=cms_latency_ms).start()
    sink = (out_dir / "text_results.jsonl").open("w", encoding="utf-8")
    with bench_env(mock):
        agent = BenchAgent(llm_temperature=llm_temperature)
        print("[bench] warming the LLM (model load + prompt cache)...", flush=True)
        warm = await agent._llm.warm([{"role": "system", "content": agent._system_prompt}], agent._llm_tools)
        await agent._llm.complete(gate_messages("hi", []), 2)
        print(f"[bench] LLM ready ({warm:.1f}s). {sum(len(c.turns or [c]) for c in selected)} cases x {repeats} repeat(s).", flush=True)
        real_llm = (agent._llm.base_url, agent._llm._timeout)
        hang: HangServer | None = None

        async def run_one(case: case_mod.Case, fresh: bool, rep: int, scenario: str | None = None, turn: int | None = None):
            nonlocal hang
            if fresh:
                agent.reset_context()
                fx = Fixtures.fresh()
                if case.setup:
                    PRESETS[case.setup](fx)
                mock.reset(fault=case.inject, fixtures=fx)
                cms_client._name_cache.clear()
            else:
                mock.fault = case.inject
            if case.inject and case.inject.get("mode") == "down":
                mock.stop()
            if case.age_before:
                agent.age_context(case.age_before)
            if case.llm_down == "refused":
                agent._llm.base_url = "http://127.0.0.1:9"
            elif case.llm_down == "hang":
                hang = hang or HangServer()
                agent._llm.base_url, agent._llm._timeout = f"http://127.0.0.1:{hang.port}", 2.0
            mark = mock.snapshot()
            trace = await (agent.run_transcript(case.utterance) if case.transcript else agent.run(case.utterance))
            calls = mock.calls_since(mark)
            res = evaluate(case, trace, calls, mock)
            res.update(repeat=rep, scenario=scenario, turn=turn)
            if case.llm_down:
                agent._llm.base_url, agent._llm._timeout = real_llm
            if case.inject and case.inject.get("mode") == "down":
                mock.start()
            return res

        for case in selected:
            for rep in range(repeats):
                batch = []
                if case.turns:
                    for i, t in enumerate(case.turns, 1):
                        batch.append(await run_one(t, fresh=(i == 1), rep=rep, scenario=case.id, turn=i))
                else:
                    batch.append(await run_one(case, fresh=True, rep=rep))
                for r in batch:
                    results.append(r)
                    sink.write(json.dumps(r, ensure_ascii=False, default=str) + "\n")
                    sink.flush()
                    if not quiet:
                        flag = "PASS" if r["success"] else "FAIL"
                        extra = "" if r["success"] else "  <- " + ",".join(r["failures"])
                        print(f"[{flag}] {r['test']:<38} {r['latency_ms'] or 0:>6}ms  {r['path'] or '-':<7} {r['input'][:48]!r}{extra}", flush=True)
        if hang:
            hang.close()
    sink.close()
    mock.stop()
    (out_dir / "fallback_stats.json").write_text(json.dumps(fallback_stats.snapshot(), indent=1), encoding="utf-8")
    print(f"[bench] fallback path: {fallback_stats.snapshot()}", flush=True)
    return results


def select_cases(categories: list[str] | None, ids: str | None, limit: int | None) -> list[case_mod.Case]:
    chosen = case_mod.all_cases()
    if categories:
        chosen = [c for c in chosen if c.category in categories]
    if ids:
        chosen = [c for c in chosen if ids.lower() in c.id.lower()]
    return chosen[:limit] if limit else chosen


def timestamp() -> str:
    return time.strftime("%Y%m%d-%H%M%S")
