"""One Travis at a time: two copies fight over the microphone and answer every command twice.

The guard is a localhost port held for the life of the process. The OS releases it however the
process ends (exit, crash, killed window), so there is no stale lock file to clean up, and it
works the same whether Travis was started by `pnpm dev` or by hand with `python main.py`.
"""

from __future__ import annotations

import socket

PORT = 47831  # arbitrary; unused by anything else on this machine
EXIT_ALREADY_RUNNING = 3  # lets a launcher tell "already up" from a crash

_held: socket.socket | None = None


def acquire(port: int = PORT) -> bool:
    """True if this process is now the only Travis; False if another one already holds the guard."""
    global _held
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        # No SO_REUSEADDR: on Windows it would let a second process bind the same port.
        s.bind(("127.0.0.1", port))
        s.listen(1)
    except OSError:
        s.close()
        return False
    _held = s  # keep a reference so it is not closed while Travis runs
    return True
