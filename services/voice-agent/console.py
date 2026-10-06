"""Console setup: the agent's log lines contain emoji, which cp1252 consoles can't encode."""

import sys


def configure_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
