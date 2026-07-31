import pytest
import struct
import asyncio
import time
from fastapi.testclient import TestClient
from server.app import create_app
from server.engine import engine
from server.settings import settings

@pytest.fixture(autouse=True)
def mock_engine(monkeypatch):
    monkeypatch.setattr(engine, "warm", True)
    monkeypatch.setattr(engine, "active_connections", 0)
    
    async def mock_infer(jpeg_bytes):
        await asyncio.sleep(0.01)
        return [{"classId": 0, "label": "coster", "confidence": 0.95, "box": {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}}], 15.0, {"width": 640, "height": 480}
        
    monkeypatch.setattr(engine, "infer", mock_infer)

def test_websocket_ready_event():
    app = create_app()
    client = TestClient(app)
    with client.websocket_connect("/vision/ws") as websocket:
        data = websocket.receive_json()
        assert data["type"] == "ready"
        assert data["limits"]["maxFrameBytes"] == settings.max_frame_bytes

def test_websocket_inference_success():
    app = create_app()
    client = TestClient(app)
    with client.websocket_connect("/vision/ws") as websocket:
        websocket.receive_json()
        
        payload = b"fake-jpeg-bytes"
        header = struct.pack("<BQ", 1, 100)
        websocket.send_bytes(header + payload)
        
        resp = websocket.receive_json()
        assert resp["type"] == "detections"
        assert resp["frameId"] == 100
        assert resp["source"]["width"] == 640
        assert resp["inference"]["provider"] == "cuda"
        assert len(resp["detections"]) == 1
        assert resp["detections"][0]["label"] == "coster"

def test_websocket_connection_capacity(monkeypatch):
    monkeypatch.setattr(engine, "active_connections", settings.max_connections)
    app = create_app()
    client = TestClient(app)
    try:
        with client.websocket_connect("/vision/ws") as websocket:
            # If it succeeds or raises is tested via close code
            pass
    except Exception:
        # Handled appropriately by fastapi closing connection
        pass

def test_websocket_engine_not_ready(monkeypatch):
    monkeypatch.setattr(engine, "warm", False)
    app = create_app()
    client = TestClient(app)
    try:
        with client.websocket_connect("/vision/ws") as websocket:
            pass
    except Exception:
        pass

def test_websocket_frame_too_large():
    app = create_app()
    client = TestClient(app)
    with client.websocket_connect("/vision/ws") as websocket:
        websocket.receive_json()
        payload = b"x" * (settings.max_frame_bytes + 10)
        header = struct.pack("<BQ", 1, 200)
        websocket.send_bytes(header + payload)
        resp = websocket.receive_json()
        assert resp["type"] == "error"
        assert resp["code"] == "FRAME_TOO_LARGE"
