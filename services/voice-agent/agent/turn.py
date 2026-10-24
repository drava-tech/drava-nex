"""Which request ("turn") the running code belongs to. A new wake word bumps the agent's
generation; code (or tasks it spawned) still running for an older turn sees it is stale.
Outside a turn TURN_GEN is None and nothing is ever stale."""

from __future__ import annotations

import contextvars

TURN_GEN: contextvars.ContextVar[int | None] = contextvars.ContextVar("travis_turn_gen", default=None)


def is_stale(agent) -> bool:
    gen = TURN_GEN.get()
    return gen is not None and gen != getattr(agent, "_generation", 0)
