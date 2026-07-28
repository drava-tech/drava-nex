"""
runtime.py — the only module that touches torch, and it does so lazily.

Why: `engine`, `http` and `ws` all need to answer "is CUDA there?" / "which
GPU?". Importing torch at module scope made every one of those modules — and
therefore the whole FastAPI app — unimportable without a ~2.5 GB torch install,
so the protocol/WS/HTTP tests could not run on a machine without the GPU stack.

Everything here degrades to "no CUDA" when torch is absent. That is safe by
construction: `InferenceEngine.load()` raises on a missing/CPU-only torch, so
production still refuses to serve without a real GPU (see settings.validate_device
and test_engine.py), while the mocked test path only ever needs the answers.
"""

from __future__ import annotations

from typing import Any


def torch_module() -> Any | None:
    """Return the imported torch module, or None if it isn't installed."""
    try:
        import torch  # noqa: PLC0415 — intentionally lazy
    except ImportError:
        return None
    return torch


def cuda_available() -> bool:
    torch = torch_module()
    if torch is None:
        return False
    try:
        return bool(torch.cuda.is_available())
    except Exception:
        return False


def gpu_name() -> str | None:
    """Human-readable device name of GPU 0, or None when unavailable."""
    torch = torch_module()
    if torch is None:
        return None
    try:
        if not torch.cuda.is_available():
            return None
        return str(torch.cuda.get_device_name(0))
    except Exception:
        return None


def gpu_memory() -> dict[str, int]:
    """Allocated/reserved bytes on GPU 0; empty dict when unavailable."""
    torch = torch_module()
    if torch is None:
        return {}
    try:
        if not torch.cuda.is_available():
            return {}
        return {
            "allocatedBytes": int(torch.cuda.memory_allocated(0)),
            "reservedBytes": int(torch.cuda.memory_reserved(0)),
        }
    except Exception:
        return {}
