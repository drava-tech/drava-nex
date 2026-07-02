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
import struct
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
        # Current templateKey of cfg.screen_id's active experience, kept in sync via
        # WELCOME/CONTENT_UPDATE once registered (see send_register_screen). None
        # until the first message arrives or when screen_id isn't configured.
        self.current_template_key: Optional[str] = None

    async def connect(self) -> None:
        """Start the background connection loop (non-blocking after first connect)."""
        self._running = True
        asyncio.create_task(self._connection_loop())

    async def _connection_loop(self) -> None:
        import ssl

        import websockets  # type: ignore

        # Only wss:// needs a context, and only when a CA file is given (e.g. a
        # locally-issued dev cert like mkcert's, which Python doesn't trust by
        # default). A publicly-trusted wss:// cert needs neither.
        ssl_context = None
        if self._cfg.ws_url.startswith("wss://") and self._cfg.ca_cert_path:
            ssl_context = ssl.create_default_context(cafile=self._cfg.ca_cert_path)
            log.info("[ws] Trusting CA cert: %s", self._cfg.ca_cert_path)

        while self._running:
            try:
                log.info("[ws] Connecting to %s", self._cfg.ws_url)
                async with websockets.connect(self._cfg.ws_url, ssl=ssl_context) as ws:
                    self._ws = ws
                    self._retry_delay = _INITIAL_RETRY_DELAY
                    log.info("[ws] Connected")
                    await self.send_register()
                    await self.send_register_screen()
                    if self._cfg.preview_enabled:
                        await self.send_stream_publish()
                    # Keep connection alive until it closes, watching for template
                    # changes on our mapped screen (see send_register_screen).
                    async for raw in ws:
                        self._handle_incoming(raw)
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

    async def send_register_screen(self) -> None:
        """
        Piggyback-register as a preview client of cfg.screen_id, if configured.
        This is the same REGISTER a CMS preview embed sends — it makes the gateway
        push WELCOME + every future CONTENT_UPDATE for that screen to us, and
        `preview: true` keeps us from counting as a live/online screen. Only used
        for template gating (see current_template_key); no-op otherwise.
        """
        if not self._cfg.screen_id:
            return
        await self._send({
            "type": "REGISTER",
            "screenId": self._cfg.screen_id,
            "preview": True,
        })

    async def send_stream_publish(self) -> None:
        """
        Register this connection as the publisher for a live-stream relay stream,
        using camera_id as the streamId — the browser already knows its screen's
        cameraId (via CAMERA_STATUS_UPDATE), so no extra identifier needs wiring up.
        Necessary because the camera is exclusively claimed by this container (via
        usbipd passthrough) — the browser can't reach it directly. Re-sent on every
        reconnect since the gateway drops publisher state on close.
        """
        await self._send({
            "type": "STREAM_PUBLISH",
            "streamId": self._cfg.camera_id,
            "format": "mjpeg",
        })

    async def send_frame(self, jpeg_bytes: bytes) -> None:
        """
        Push one MJPEG preview frame over the live-stream binary relay. Wire format
        (fixed by packages/ui/src/templates/live-stream/use-live-stream.ts):
        [frameType:1B][timestamp:8B uint64 LE][payload]. frameType=1 (keyframe) so
        the gateway caches it and instantly bootstraps new corner-box viewers.
        """
        if self._ws is None:
            return
        header = struct.pack("<BQ", 1, int(time.time() * 1000))
        try:
            await self._ws.send(header + jpeg_bytes)
        except Exception as e:
            log.warning("[ws] Preview frame send failed: %s", e)
            self._ws = None

    def _handle_incoming(self, raw: str | bytes) -> None:
        """Track the mapped screen's current templateKey from WELCOME/CONTENT_UPDATE."""
        if not self._cfg.screen_id:
            return
        try:
            msg = json.loads(raw)
        except (ValueError, TypeError):
            return
        if msg.get("type") in ("WELCOME", "CONTENT_UPDATE") and msg.get("screenId") == self._cfg.screen_id:
            content = msg.get("content") or {}
            self.current_template_key = content.get("templateKey")
            log.info("[ws] screen %s templateKey -> %r", self._cfg.screen_id, self.current_template_key)

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
