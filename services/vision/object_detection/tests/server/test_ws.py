"""/vision/ws protocol tests against a mocked engine — no GPU, no model weight.

engine.infer is patched, so nothing here imports torch, ultralytics or cv2.
The app is built with a no-op lifespan for the same reason: the real one calls
engine.load(), which (correctly) refuses to run without CUDA.
"""

import asyncio
import struct
import time
from contextlib import asynccontextmanager

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from vision.object_detection.server.engine import engine
from vision.object_detection.server.http import router as http_router
from vision.object_detection.server.settings import settings
from vision.object_detection.server.ws import router as ws_router

ONE_DETECTION = [
    {
        "classId": 0,
        "label": "coster",
        "confidence": 0.95,
        "box": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4},
    }
]


def build_test_app() -> FastAPI:
    """Same routers as create_app(), minus the model-loading lifespan."""

    @asynccontextmanager
    async def noop_lifespan(_app: FastAPI):
        yield

    app = FastAPI(lifespan=noop_lifespan)
    app.include_router(ws_router)
    app.include_router(http_router)
    return app


def frame(frame_id: int, payload: bytes = b"fake-jpeg-bytes", frame_type: int = 1) -> bytes:
    return struct.pack("<BQ", frame_type, frame_id) + payload


@pytest.fixture(autouse=True)
def mock_engine(monkeypatch):
    monkeypatch.setattr(engine, "warm", True)
    monkeypatch.setattr(engine, "active_connections", 0)
    monkeypatch.setattr(engine, "frames_dropped_busy", 0)
    monkeypatch.setattr(engine, "frames_dropped_limit", 0)
    # A real GPU name is unavailable here; ws.py falls back to settings.device.
    monkeypatch.setattr("vision.object_detection.server.ws.gpu_name", lambda: "MockGPU")

    async def mock_infer(_jpeg_bytes):
        await asyncio.sleep(0.01)
        return list(ONE_DETECTION), 15.0, {"width": 640, "height": 480}

    monkeypatch.setattr(engine, "infer", mock_infer)


@pytest.fixture
def client():
    with TestClient(build_test_app()) as c:
        yield c


# ── handshake ─────────────────────────────────────────────────────────────────

def test_websocket_ready_event(client):
    with client.websocket_connect("/vision/ws") as ws:
        data = ws.receive_json()
        assert data["type"] == "ready"
        assert data["limits"]["maxFrameBytes"] == settings.max_frame_bytes
        assert data["limits"]["minFrameIntervalMs"] == settings.min_frame_interval_ms
        # ModelInfo, not a raw path — the browser shows this in the debug overlay.
        assert set(data["model"]) == {"id", "version", "file"}
        assert "/" not in data["model"]["file"] and "\\" not in data["model"]["file"]


# ── happy path ────────────────────────────────────────────────────────────────

def test_websocket_inference_success(client):
    with client.websocket_connect("/vision/ws") as ws:
        ws.receive_json()
        ws.send_bytes(frame(100))

        resp = ws.receive_json()
        assert resp["type"] == "detections"
        assert resp["frameId"] == 100
        assert resp["source"] == {"width": 640, "height": 480}
        assert resp["inference"]["provider"] == "cuda"
        assert resp["inference"]["processingTimeMs"] == 15.0
        assert resp["model"]["id"] == settings.model_id

        assert len(resp["detections"]) == 1
        det = resp["detections"][0]
        assert det["classId"] == 0
        assert det["label"] == "coster"
        assert det["confidence"] == pytest.approx(0.95)
        assert det["box"] == {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}


def test_websocket_no_detections_is_an_empty_list_not_an_error(monkeypatch, client):
    """An empty frame must round-trip as detections:[] — the browser's stability
    filter counts it as a miss, and an error would instead stall the loop."""

    async def empty_infer(_jpeg_bytes):
        return [], 8.0, {"width": 640, "height": 480}

    monkeypatch.setattr(engine, "infer", empty_infer)

    with client.websocket_connect("/vision/ws") as ws:
        ws.receive_json()
        ws.send_bytes(frame(101))
        resp = ws.receive_json()
        assert resp["type"] == "detections"
        assert resp["detections"] == []


def test_websocket_returns_all_detections_for_client_side_best_pick(monkeypatch, client):
    """The server does not pick a winner — useServerDetection reduces to the
    highest-confidence detection itself, so every box must be forwarded."""

    async def multi_infer(_jpeg_bytes):
        return (
            [
                {"classId": 0, "label": "coster", "confidence": 0.42,
                 "box": {"x": 0.0, "y": 0.0, "width": 0.1, "height": 0.1}},
                {"classId": 0, "label": "coster", "confidence": 0.97,
                 "box": {"x": 0.5, "y": 0.5, "width": 0.2, "height": 0.2}},
                {"classId": 1, "label": "smart_glasses", "confidence": 0.63,
                 "box": {"x": 0.2, "y": 0.2, "width": 0.1, "height": 0.1}},
            ],
            11.0,
            {"width": 640, "height": 480},
        )

    monkeypatch.setattr(engine, "infer", multi_infer)

    with client.websocket_connect("/vision/ws") as ws:
        ws.receive_json()
        ws.send_bytes(frame(102))
        resp = ws.receive_json()

        assert len(resp["detections"]) == 3
        best = max(resp["detections"], key=lambda d: d["confidence"])
        assert best["label"] == "coster"
        assert best["confidence"] == pytest.approx(0.97)


# ── malformed / oversized frames ──────────────────────────────────────────────

def test_websocket_bad_frame_header(client):
    with client.websocket_connect("/vision/ws") as ws:
        ws.receive_json()
        ws.send_bytes(b"\x01\x02")  # shorter than the 9-byte header
        resp = ws.receive_json()
        assert resp["type"] == "error"
        assert resp["code"] == "BAD_FRAME"


def test_websocket_unsupported_frame_type(client):
    with client.websocket_connect("/vision/ws") as ws:
        ws.receive_json()
        ws.send_bytes(frame(103, frame_type=0x09))
        resp = ws.receive_json()
        assert resp["type"] == "error"
        assert resp["code"] == "BAD_FRAME"
        assert resp["frameId"] == 103


def test_websocket_frame_too_large(client):
    with client.websocket_connect("/vision/ws") as ws:
        ws.receive_json()
        ws.send_bytes(frame(200, b"x" * (settings.max_frame_bytes + 10)))
        resp = ws.receive_json()
        assert resp["type"] == "error"
        assert resp["code"] == "FRAME_TOO_LARGE"
        assert resp["frameId"] == 200


def test_websocket_invalid_jpeg_reports_bad_frame(monkeypatch, client):
    async def raises(_jpeg_bytes):
        raise ValueError("Invalid image bytes")

    monkeypatch.setattr(engine, "infer", raises)

    with client.websocket_connect("/vision/ws") as ws:
        ws.receive_json()
        ws.send_bytes(frame(204))
        resp = ws.receive_json()
        assert resp["type"] == "error"
        assert resp["code"] == "BAD_FRAME"


def test_websocket_internal_error_is_reported_not_fatal(monkeypatch, client):
    async def boom(_jpeg_bytes):
        raise RuntimeError("cuda oom")

    monkeypatch.setattr(engine, "infer", boom)

    with client.websocket_connect("/vision/ws") as ws:
        ws.receive_json()
        ws.send_bytes(frame(205))
        resp = ws.receive_json()
        assert resp["type"] == "error"
        assert resp["code"] == "INTERNAL"


# ── throttling ────────────────────────────────────────────────────────────────

def test_websocket_rate_limited(monkeypatch, client):
    # A high floor makes the second frame land inside the window deterministically.
    monkeypatch.setattr(settings, "min_frame_interval_ms", 60_000)

    with client.websocket_connect("/vision/ws") as ws:
        ws.receive_json()
        ws.send_bytes(frame(300))
        assert ws.receive_json()["type"] == "detections"

        ws.send_bytes(frame(301))
        resp = ws.receive_json()
        assert resp["type"] == "error"
        assert resp["code"] == "RATE_LIMITED"
        assert resp["frameId"] == 301
    assert engine.frames_dropped_limit == 1


def test_websocket_inference_timeout(monkeypatch, client):
    monkeypatch.setattr(settings, "inference_timeout_ms", 20)
    monkeypatch.setattr(settings, "min_frame_interval_ms", 0)

    async def slow_infer(_jpeg_bytes):
        await asyncio.sleep(1.0)
        return [], 0.0, {"width": 1, "height": 1}

    monkeypatch.setattr(engine, "infer", slow_infer)

    with client.websocket_connect("/vision/ws") as ws:
        ws.receive_json()
        ws.send_bytes(frame(400))
        resp = ws.receive_json()
        assert resp["type"] == "error"
        assert resp["code"] == "INFERENCE_TIMEOUT"


# ── admission control ─────────────────────────────────────────────────────────

def test_websocket_connection_capacity(monkeypatch, client):
    monkeypatch.setattr(engine, "active_connections", settings.max_connections)
    with pytest.raises(Exception):
        with client.websocket_connect("/vision/ws") as ws:
            ws.receive_json()


def test_websocket_engine_not_ready(monkeypatch, client):
    monkeypatch.setattr(engine, "warm", False)
    with pytest.raises(Exception):
        with client.websocket_connect("/vision/ws") as ws:
            ws.receive_json()


def test_active_connection_count_is_released_on_disconnect(client):
    """A leaked slot here would eventually make the server refuse every client
    with "Capacity exceeded" until it is restarted."""
    with client.websocket_connect("/vision/ws") as ws:
        ws.receive_json()  # the ready frame proves the handler ran past the increment
        assert engine.active_connections == 1

    # The endpoint's `finally` runs on the server task, which TestClient does not
    # join on close — wait for it rather than racing it.
    deadline = time.monotonic() + 2.0
    while engine.active_connections != 0 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert engine.active_connections == 0


# ── HTTP health endpoints ─────────────────────────────────────────────────────

def test_healthz_is_liveness_only(client):
    resp = client.get("/vision/healthz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_readyz_503_when_model_cold(monkeypatch, client):
    monkeypatch.setattr(engine, "warm", False)
    resp = client.get("/vision/readyz")
    assert resp.status_code == 503
    assert resp.json()["status"] == "not_ready"
    assert resp.json()["modelLoaded"] is False


def test_readyz_503_when_warm_but_no_cuda(monkeypatch, client):
    """Warm alone is not enough — CUDA has to be there too."""
    monkeypatch.setattr("vision.object_detection.server.http.cuda_available", lambda: False)
    resp = client.get("/vision/readyz")
    assert resp.status_code == 503
    assert resp.json()["cudaAvailable"] is False


def test_readyz_200_only_when_warm_and_cuda(monkeypatch, client):
    monkeypatch.setattr("vision.object_detection.server.http.cuda_available", lambda: True)
    monkeypatch.setattr("vision.object_detection.server.http.gpu_name", lambda: "MockGPU")
    resp = client.get("/vision/readyz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["modelLoaded"] is True
    assert body["inferenceDevice"] == settings.device


def test_info_reports_model_and_metrics(client):
    body = client.get("/vision/info").json()
    assert body["model"]["id"] == settings.model_id
    assert body["model"]["file"] == settings.model_file
    assert "framesProcessed" in body["metrics"]
    assert "activeConnections" in body["metrics"]
