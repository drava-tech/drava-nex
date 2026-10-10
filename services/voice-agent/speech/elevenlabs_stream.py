"""ElevenLabs ultra-low-latency streaming TTS client for TRAVIS.

Streams text tokens directly into ElevenLabs' input-streaming WebSocket
(model: eleven_flash_v2_5) and yields raw PCM chunks (at `tts_sample_rate`) directly into
TRAVIS's audio playback queue, achieving ~75-100ms TTFB.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Optional
import websockets
from websockets.protocol import State

from settings import RECEIVE_SAMPLE_RATE

logger = logging.getLogger(__name__)


def _is_open(ws) -> bool:
    """websockets>=13 dropped ClientConnection.closed; check .state instead."""
    return ws is not None and ws.state is State.OPEN


class ElevenLabsStreamer:
    """Manages an active ElevenLabs input-streaming WebSocket session."""

    def __init__(
        self,
        api_key: str,
        voice_id: str,
        model_id: str = "eleven_flash_v2_5",
        sample_rate: Optional[int] = None,
        audio_queue: Optional[asyncio.Queue] = None,
    ):
        self.api_key = api_key.strip()
        self.voice_id = voice_id.strip()
        self.model_id = model_id.strip() or "eleven_flash_v2_5"
        self.sample_rate = sample_rate if sample_rate is not None else RECEIVE_SAMPLE_RATE
        self.audio_queue = audio_queue

        self._ws = None
        self._recv_task: Optional[asyncio.Task] = None
        self._is_connected = False
        self._session_lock = asyncio.Lock()

    @property
    def is_available(self) -> bool:
        return bool(self.api_key and self.voice_id)

    async def ensure_session(self) -> bool:
        """Ensure an active WebSocket session is open and handshaked."""
        if _is_open(self._ws):
            return True

        async with self._session_lock:
            if _is_open(self._ws):
                return True

            uri = (
                f"wss://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}/stream-input"
                f"?model_id={self.model_id}&output_format=pcm_{self.sample_rate}"
                # Default is 20 s: a session pre-warmed at the wake word was
                # closed (1008) before slow replies (LLM + retry) sent any text.
                f"&inactivity_timeout=180"
            )
            try:
                self._ws = await websockets.connect(uri)
                # Initial handshake payload
                handshake = {
                    "text": " ",
                    "voice_settings": {
                        "stability": 0.5,
                        "similarity_boost": 0.8,
                    },
                    "xi_api_key": self.api_key,
                }
                await self._ws.send(json.dumps(handshake))
                self._is_connected = True

                # Start background receiver task
                if self._recv_task and not self._recv_task.done():
                    self._recv_task.cancel()
                self._recv_task = asyncio.create_task(self._receive_loop())
                return True
            except Exception as exc:
                print(f"[ElevenLabs] ⚠️ Connection failed: {exc}")
                self._ws = None
                self._is_connected = False
                return False

    async def prewarm(self) -> bool:
        """Open the WebSocket session ahead of the first send_text() call.

        Safe to call repeatedly (e.g. on every wake word) — ensure_session()
        is a fast no-op once a session is already open. Failures are logged
        by ensure_session() itself; callers don't need their own try/except.
        """
        return await self.ensure_session()

    async def send_text(self, text: str) -> None:
        """Send a chunk of text to be synthesized immediately."""
        if not text or not self.is_available:
            return

        if not await self.ensure_session():
            return

        try:
            payload = {
                "text": text,
                "try_trigger_generation": True,
            }
            if _is_open(self._ws):
                await self._ws.send(json.dumps(payload))
        except Exception as exc:
            print(f"[ElevenLabs] ⚠️ Send error: {exc}")
            await self.cancel()

    async def flush(self) -> None:
        """Signal turn completion so ElevenLabs flushes any buffered audio."""
        if not _is_open(self._ws):
            return
        try:
            # An empty string signals the end of the text generation block
            await self._ws.send(json.dumps({"text": ""}))
        except Exception:
            pass

    async def cancel(self) -> None:
        """Immediately terminate synthesis and drop remaining audio (barge-in)."""
        async with self._session_lock:
            if self._recv_task and not self._recv_task.done():
                self._recv_task.cancel()
                self._recv_task = None

            if _is_open(self._ws):
                try:
                    await self._ws.close()
                except Exception:
                    pass
            self._ws = None
            self._is_connected = False

    async def _receive_loop(self) -> None:
        """Receive base64 audio chunks from ElevenLabs and enqueue PCM bytes."""
        ws = self._ws
        finished = False
        try:
            if not ws:
                return

            async for raw_msg in ws:
                try:
                    msg = json.loads(raw_msg)
                    audio_b64 = msg.get("audio")
                    if audio_b64:
                        pcm_bytes = base64.b64decode(audio_b64)
                        if self.audio_queue is not None and pcm_bytes:
                            self.audio_queue.put_nowait(pcm_bytes)

                    if msg.get("isFinal"):
                        # Session complete; the next send_text() opens a new one.
                        finished = True
                        break
                except Exception as parse_err:
                    print(f"[ElevenLabs] Audio decode error: {parse_err}")
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            print(f"[ElevenLabs] Recv error: {exc}")
        finally:
            self._is_connected = False
            # Nothing reads this socket any more: drop it, or ensure_session()
            # would see it still OPEN and skip starting a receiver, silently
            # losing the next reply's audio (hit by the local pipeline, which
            # flushes after every reply).
            if finished and ws is not None and self._ws is ws:
                self._ws = None
                try:
                    await ws.close()
                except Exception:
                    pass
