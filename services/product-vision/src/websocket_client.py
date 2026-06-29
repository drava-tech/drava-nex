"""
websocket_client.py — WebSocket client for the Product Vision service.

Connects to the CMS API gateway (apps/api) via the ws:// protocol and sends
typed detection events. The gateway then resolves the detection label to an
active product and broadcasts the product display data to connected screens.

Event shapes (must match packages/types/src/products.ts):

    PRODUCT_DETECTED  — fired when a stable detection is confirmed
    PRODUCT_LOST      — fired when the product leaves the frame

The client reconnects automatically on disconnect with exponential backoff.

Usage:
    client = WsClient(config)
    await client.connect()
    await client.send_detected(label, confidence, detected_at)
    await client.send_lost(label)
    await client.close()
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Optional

from config import Config

log = logging.getLogger(__name__)

_INITIAL_RETRY_DELAY = 2.0   # seconds
_MAX_RETRY_DELAY = 60.0      # seconds cap on backoff


class WsClient:
    """
    Persistent WebSocket connection to the CMS API gateway.

    Reconnects with exponential backoff. All send methods are fire-and-forget
    coroutines — they drop the message silently if not connected, since a missed
    single frame is always recoverable from the next detected event.
    """

    def __init__(self, cfg: Config) -> None:
        self._cfg = cfg
        self._ws = None
        self._retry_delay = _INITIAL_RETRY_DELAY
        self._running = False

    async def connect(self) -> None:
        """Start the background connection loop (non-blocking after first connect)."""
        self._running = True
        asyncio.create_task(self._connection_loop())

    async def _connection_loop(self) -> None:
        import websockets  # type: ignore

        while self._running:
            try:
                log.info("[ws] Connecting to %s", self._cfg.ws_url)
                async with websockets.connect(self._cfg.ws_url) as ws:
                    self._ws = ws
                    self._retry_delay = _INITIAL_RETRY_DELAY
                    log.info("[ws] Connected")
                    await self.send_register()
                    # Keep connection alive until it closes
                    async for _ in ws:
                        pass  # We only send; ignore incoming messages
            except Exception as e:
                self._ws = None
                log.warning("[ws] Disconnected (%s). Retrying in %.0fs", e, self._retry_delay)
                await asyncio.sleep(self._retry_delay)
                self._retry_delay = min(self._retry_delay * 2, _MAX_RETRY_DELAY)

    async def send_detected(self, label: str, confidence: float) -> None:
        """Send a PRODUCT_DETECTED event to the gateway."""
        await self._send({
            "type": "PRODUCT_DETECTED",
            "cameraId": self._cfg.camera_id,
            "label": label,
            "confidence": round(confidence, 4),
            "detectedAt": _iso_now(),
        })

    async def send_lost(self, label: str) -> None:
        """Send a PRODUCT_LOST event to the gateway."""
        await self._send({
            "type": "PRODUCT_LOST",
            "cameraId": self._cfg.camera_id,
            "label": label,
            "lostAt": _iso_now(),
        })

    async def send_register(self) -> None:
        """Register this process as the status publisher for a camera."""
        await self._send({
            "type": "CAMERA_REGISTER",
            "cameraId": self._cfg.camera_id,
            "registeredAt": _iso_now(),
        })

    async def send_heartbeat(self) -> None:
        """Tell the gateway the camera service process is still alive."""
        await self._send({
            "type": "CAMERA_HEARTBEAT",
            "cameraId": self._cfg.camera_id,
            "sentAt": _iso_now(),
        })

    async def send_status(self, status: str, message: Optional[str] = None) -> None:
        """Publish the current camera hardware/detection state."""
        payload = {
            "type": "CAMERA_STATUS",
            "cameraId": self._cfg.camera_id,
            "status": status,
            "updatedAt": _iso_now(),
        }
        if message:
            payload["message"] = message
        await self._send(payload)

    async def _send(self, payload: dict) -> None:
        if self._ws is None:
            log.debug("[ws] Not connected — dropping event: %s", payload.get("type"))
            return
        try:
            await self._ws.send(json.dumps(payload))
            log.debug("[ws] Sent %s", payload.get("type"))
        except Exception as e:
            log.warning("[ws] Send failed: %s", e)
            self._ws = None

    async def close(self) -> None:
        self._running = False
        if self._ws:
            await self._ws.close()
            self._ws = None


def _iso_now() -> str:
    """Current UTC time in ISO 8601 format."""
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
