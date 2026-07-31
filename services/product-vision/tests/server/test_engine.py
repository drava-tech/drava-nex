import pytest
from pydantic import ValidationError
from server.settings import VisionServerSettings
from server.engine import InferenceEngine

def test_device_validation_non_cuda():
    with pytest.raises(ValidationError):
        VisionServerSettings(device="cpu")

def test_device_validation_cuda():
    cfg = VisionServerSettings(device="cuda:0")
    assert cfg.device == "cuda:0"

def test_engine_load_no_cuda(monkeypatch):
    import torch
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    
    eng = InferenceEngine()
    with pytest.raises(RuntimeError) as excinfo:
        eng.load()
    assert "CUDA is not available" in str(excinfo.value)
