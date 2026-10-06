"""Local LLM for TRAVIS: Qwen3-8B served by Ollama.

Handles whatever the rule-based fast path (nlu/command_matcher.py) didn't
match. Talks to Ollama's native /api/chat with streaming, thinking disabled
(Qwen3 would otherwise reason for seconds before a one-line answer), and the
same tool declarations Gemini had, converted to JSON Schema.

Public API:
    tools_to_json_schema(declarations) -> list[dict]
    OllamaChat(...).stream(messages, tools) -> async iterator of
        ("text", str) chunks, then at most one ("tool_calls", [ToolCall])
    OllamaChat.warm(messages, tools)   load the model + cache the prompt prefix
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, AsyncIterator

# pyrefly: ignore [missing-import]
import httpx


@dataclass
class ToolCall:
    name: str
    args: dict


class LocalLLMError(Exception):
    pass


def _convert_schema(node: Any) -> Any:
    """Gemini's OBJECT/STRING/... type names -> JSON Schema's lowercase ones."""
    if isinstance(node, dict):
        out = {}
        for k, v in node.items():
            if k == "type" and isinstance(v, str):
                out[k] = v.lower()
            else:
                out[k] = _convert_schema(v)
        return out
    if isinstance(node, list):
        return [_convert_schema(v) for v in node]
    return node


def tools_to_json_schema(declarations: list[dict]) -> list[dict]:
    tools = []
    for decl in declarations:
        params: dict = _convert_schema(decl.get("parameters") or {"type": "OBJECT"})
        params = {"properties": {}, **params}
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": decl["name"],
                    "description": decl.get("description", ""),
                    "parameters": params,
                },
            }
        )
    return tools


def _parse_args(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


class OllamaChat:
    def __init__(
        self,
        base_url: str = "http://127.0.0.1:11434",
        model: str = "qwen3:8b",
        num_ctx: int = 8192,
        temperature: float = 0.3,
        keep_alive: str = "30m",
        timeout: float = 60.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self._transport = transport  # tests swap in httpx.MockTransport
        self.model = model
        self._options = {"num_ctx": num_ctx, "temperature": temperature}
        self._keep_alive = keep_alive
        self._timeout = timeout

    def _payload(self, messages: list[dict], tools: list[dict], stream: bool, **options) -> dict:
        return {
            "model": self.model,
            "messages": messages,
            "tools": tools,
            "stream": stream,
            "think": False,
            "keep_alive": self._keep_alive,
            "options": {**self._options, **options},
        }

    async def check(self) -> None:
        """Raise LocalLLMError unless Ollama is up and has the model pulled."""
        try:
            async with httpx.AsyncClient(timeout=5.0, transport=self._transport) as client:
                res = await client.get(f"{self.base_url}/api/tags")
                res.raise_for_status()
        except Exception as e:
            raise LocalLLMError(
                f"Ollama isn't reachable at {self.base_url} ({e}). Install/start Ollama, "
                f"then `ollama pull {self.model}`."
            ) from e
        names = {m.get("name") for m in res.json().get("models", [])}
        wanted = self.model if ":" in self.model else f"{self.model}:latest"
        if wanted not in names:
            raise LocalLLMError(f"Ollama doesn't have {self.model} yet. Run: ollama pull {self.model}")

    async def warm(self, messages: list[dict], tools: list[dict]) -> float:
        """Load the model into VRAM and process the system prompt + tools once,
        so Ollama's prompt cache makes the first real request fast. Returns
        the seconds it took."""
        import time

        started = time.monotonic()
        async with httpx.AsyncClient(timeout=httpx.Timeout(self._timeout * 3), transport=self._transport) as client:
            res = await client.post(
                f"{self.base_url}/api/chat",
                json=self._payload(messages, tools, stream=False, num_predict=1),
            )
            res.raise_for_status()
        return time.monotonic() - started

    async def complete(self, messages: list[dict], max_tokens: int = 4) -> str:
        """A short, deterministic, tool-less answer (used for yes/no
        classification). Not streamed."""
        payload = self._payload(messages, [], stream=False, num_predict=max_tokens, temperature=0.0)
        payload.pop("tools")
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout, connect=5.0), transport=self._transport
            ) as client:
                res = await client.post(f"{self.base_url}/api/chat", json=payload)
                if res.status_code != 200:
                    raise LocalLLMError(f"Ollama returned {res.status_code}: {res.text[:200]}")
                return str((res.json().get("message") or {}).get("content") or "").strip()
        except httpx.HTTPError as e:
            raise LocalLLMError(f"Ollama request failed: {e}") from e

    async def stream(self, messages: list[dict], tools: list[dict]) -> AsyncIterator[tuple[str, Any]]:
        calls: list[ToolCall] = []
        in_think = False
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(self._timeout, connect=5.0), transport=self._transport
            ) as client:
                async with client.stream(
                    "POST", f"{self.base_url}/api/chat", json=self._payload(messages, tools, stream=True)
                ) as res:
                    if res.status_code != 200:
                        body = (await res.aread()).decode("utf-8", "replace")
                        raise LocalLLMError(f"Ollama returned {res.status_code}: {body[:200]}")
                    async for line in res.aiter_lines():
                        if not line.strip():
                            continue
                        chunk = json.loads(line)
                        if chunk.get("error"):
                            raise LocalLLMError(str(chunk["error"]))
                        msg = chunk.get("message") or {}
                        for tc in msg.get("tool_calls") or []:
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                calls.append(ToolCall(fn["name"], _parse_args(fn.get("arguments"))))
                        text = msg.get("content") or ""
                        # Belt and braces: thinking is disabled, but never
                        # let a stray <think> block reach the speaker.
                        if "<think>" in text:
                            in_think = True
                        if in_think:
                            if "</think>" in text:
                                in_think = False
                                text = text.split("</think>", 1)[1]
                            else:
                                continue
                        if text:
                            yield ("text", text)
                        if chunk.get("done"):
                            break
        except httpx.HTTPError as e:
            raise LocalLLMError(f"Ollama request failed: {e}") from e
        if calls:
            yield ("tool_calls", calls)
