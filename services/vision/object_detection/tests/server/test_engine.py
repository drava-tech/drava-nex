"""Engine startup guards — CUDA requirement, model file, checksum, class names.

All GPU-free: `load()` never gets past its CUDA check here, and the file /
checksum / class-name checks are deliberately separable from any torch work.
"""

import asyncio
import hashlib

import pytest
from pydantic import ValidationError

from vision.object_detection.server import runtime
from vision.object_detection.server.engine import (
    InferenceEngine,
    ModelChecksumError,
    ModelNotFoundError,
)
from vision.object_detection.server.settings import VisionServerSettings, settings


# ── device / settings validation ──────────────────────────────────────────────

def test_device_validation_non_cuda():
    with pytest.raises(ValidationError):
        VisionServerSettings(device="cpu")


def test_device_validation_cuda():
    cfg = VisionServerSettings(device="cuda:0")
    assert cfg.device == "cuda:0"


def test_conf_threshold_out_of_range():
    with pytest.raises(ValidationError):
        VisionServerSettings(conf_threshold=1.5)


def test_model_file_strips_directories_on_both_separators():
    assert (
        VisionServerSettings(model_path="/app/models/production/coster-v1.pt").model_file
        == "coster-v1.pt"
    )
    assert VisionServerSettings(model_path=r"C:\models\coster-v1.pt").model_file == "coster-v1.pt"


# ── CUDA-only production check ────────────────────────────────────────────────

def test_engine_load_no_cuda(monkeypatch):
    monkeypatch.setattr("vision.object_detection.server.engine.cuda_available", lambda: False)

    eng = InferenceEngine()
    with pytest.raises(RuntimeError) as excinfo:
        eng.load()
    assert "CUDA is not available" in str(excinfo.value)


def test_runtime_reports_no_cuda_without_torch(monkeypatch):
    monkeypatch.setattr(runtime, "torch_module", lambda: None)
    assert runtime.cuda_available() is False
    assert runtime.gpu_name() is None
    assert runtime.gpu_memory() == {}


# ── missing model / checksum mismatch ─────────────────────────────────────────

def test_verify_model_file_missing(monkeypatch, tmp_path):
    missing = tmp_path / "not-there.pt"
    monkeypatch.setattr(settings, "model_path", str(missing))
    monkeypatch.setattr(settings, "model_sha256", None)

    eng = InferenceEngine()
    with pytest.raises(ModelNotFoundError) as excinfo:
        eng.verify_model_file()
    assert "not found" in str(excinfo.value)


def test_verify_model_file_checksum_mismatch(monkeypatch, tmp_path):
    weight = tmp_path / "coster-v1.pt"
    weight.write_bytes(b"not the real weight")
    monkeypatch.setattr(settings, "model_path", str(weight))
    monkeypatch.setattr(settings, "model_sha256", "0" * 64)

    eng = InferenceEngine()
    with pytest.raises(ModelChecksumError) as excinfo:
        eng.verify_model_file()
    assert "SHA-256 mismatch" in str(excinfo.value)


def test_verify_model_file_checksum_match(monkeypatch, tmp_path):
    payload = b"pretend weight bytes"
    weight = tmp_path / "coster-v1.pt"
    weight.write_bytes(payload)
    monkeypatch.setattr(settings, "model_path", str(weight))
    # Case-insensitive on purpose — checksums.txt is lowercase but env vars get
    # pasted in either case.
    monkeypatch.setattr(settings, "model_sha256", hashlib.sha256(payload).hexdigest().upper())

    InferenceEngine().verify_model_file()  # must not raise


def test_verify_model_file_skips_checksum_when_unset(monkeypatch, tmp_path):
    weight = tmp_path / "coster-v1.pt"
    weight.write_bytes(b"anything")
    monkeypatch.setattr(settings, "model_path", str(weight))
    monkeypatch.setattr(settings, "model_sha256", None)

    InferenceEngine().verify_model_file()  # must not raise


# ── YOLO class names must be valid CMS detection labels ───────────────────────

def test_class_names_matching_cms_detection_label():
    InferenceEngine.verify_class_names({0: "coster", 1: "smart_glasses"})


@pytest.mark.parametrize("bad", ["Coster", "smart glasses", "smart-glasses", "coster!"])
def test_class_names_rejected_when_not_a_cms_detection_label(bad):
    with pytest.raises(RuntimeError) as excinfo:
        InferenceEngine.verify_class_names({0: bad})
    assert "detection labels" in str(excinfo.value)


def test_class_names_empty_rejected():
    with pytest.raises(RuntimeError):
        InferenceEngine.verify_class_names({})


# ── infer() refuses to run cold ───────────────────────────────────────────────

def test_infer_requires_warm_engine():
    eng = InferenceEngine()
    assert eng.warm is False
    with pytest.raises(RuntimeError) as excinfo:
        asyncio.run(eng.infer(b"jpeg"))
    assert "not warmed up" in str(excinfo.value)
