"""TRAVIS voice agent entry point: process bootstrap, then start the UI and the agent.

Everything else lives in packages: `settings` (paths + config), `agent` (the voice agent),
`speech` (VAD/STT/TTS), `nlu` (commands + local LLM), `safety` (guards), `audio`, `wake`,
`actions` (CMS calls), `rag`, `memory`.
"""

import os
import sys
import warnings
from pathlib import Path

# Re-exec into the adjacent .venv when started from another Python.
# os.path.samefile() (identity, via the OS) rather than Path.resolve() equality
# (string comparison): on Windows the same interpreter can resolve to two
# different-looking paths (short vs. long form, drive letter casing), which made
# this misfire and spawn an extra, untracked child on every launch, so several
# copies ended up running at once and fighting over the mic.
_venv_py = Path(__file__).resolve().parent / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
try:
    _already_in_venv = _venv_py.is_file() and os.path.samefile(sys.executable, _venv_py)
except OSError:
    _already_in_venv = False
if _venv_py.is_file() and not _already_in_venv:
    import subprocess

    sys.exit(subprocess.call([str(_venv_py), *sys.argv]))

warnings.filterwarnings("ignore", message=r"there are non-data parts in the response.*")

# This service uses no pydantic plugins. Without this, pydantic scans the metadata of every
# installed package at import time, which on Windows (cold cache + antivirus) can stall startup.
os.environ.setdefault("PYDANTIC_DISABLE_PLUGINS", "__all__")

import asyncio  # noqa: E402
import threading  # noqa: E402
import traceback  # noqa: E402

from agent import single_instance  # noqa: E402
from agent.local import TravisLocal  # noqa: E402
from ui import TravisUI  # noqa: E402


def _warm_rag() -> None:
    """Build/refresh the knowledge index and load the embedding model in the background, so the first
    knowledge_search doesn't wait for either. Needs Ollama; failures only skip the warm-up."""
    try:
        from rag import retriever

        retriever.warm_index()
        retriever._embed_query("warm up")
    except Exception as e:
        print(f"[Voice Agent] ⚠️ RAG warm-up skipped: {e}")


def _raise_priority() -> None:
    """Above-normal CPU priority on Windows, so the dev servers (Next, tsc) running next to Travis can't
    starve audio capture and Whisper's CPU-side work. Not HIGH: the UI and the system must stay responsive."""
    if os.name != "nt":
        return
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        # Explicit 64-bit handle types: ctypes' default int conversion truncates the pseudo-handle.
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        kernel32.SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel32.SetPriorityClass.restype = wintypes.BOOL
        kernel32.SetPriorityClass(kernel32.GetCurrentProcess(), 0x00008000)  # ABOVE_NORMAL_PRIORITY_CLASS
    except Exception:
        pass


def main() -> None:
    if not single_instance.acquire():
        print("[Voice Agent] Travis is already running — not starting a second copy.")
        sys.exit(single_instance.EXIT_ALREADY_RUNNING)
    _raise_priority()
    ui = TravisUI("face.png")

    def runner():
        try:
            ui.wait_for_api_key()
            threading.Thread(target=_warm_rag, daemon=True, name="rag-warm").start()
            asyncio.run(TravisLocal(ui).run())
        except KeyboardInterrupt:
            print("\n🔴 Shutting down...")
        except Exception as e:
            # Anything raised before the agent's own loop is running (UI init, wait_for_api_key)
            # would otherwise die quietly in this daemon thread while the window keeps running,
            # frozen with no voice backend. Surface it in both places someone might look.
            print(f"[Voice Agent] 🛑 FATAL — voice backend crashed at startup: {e}")
            traceback.print_exc()
            try:
                ui.set_connection("offline")
                ui.write_log(f"SYS: FATAL — voice backend crashed: {e}")
            except Exception:
                pass

    threading.Thread(target=runner, daemon=True).start()
    ui.root.mainloop()


if __name__ == "__main__":
    main()
