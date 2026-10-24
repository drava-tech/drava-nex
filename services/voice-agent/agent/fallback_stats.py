"""Counts of the model calls the fallback path made or skipped, and why (read by the benchmarks; free in normal use).

The fallback path is what runs when the planner says a request is neither a room command nor a question about the company: the room-state check,
the relevance gate, the knowledge probe, the tool-calling model. An embedding or a sentence's shape decides which of them are needed
(`room_state.skipped_*`, `probe.skipped_*`); the counters say how often.
"""

from __future__ import annotations

from collections import Counter

STATS: Counter = Counter()


def note(key: str, n: int = 1) -> None:
    STATS[key] += n


def snapshot() -> dict:
    return dict(sorted(STATS.items()))


def reset() -> None:
    STATS.clear()
