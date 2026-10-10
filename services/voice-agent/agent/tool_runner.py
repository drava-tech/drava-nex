"""Running the tools the model or fast path asks for (devices, screens, visuals, knowledge)."""

from __future__ import annotations

import asyncio
import os
import threading
import time
import traceback


# pyrefly: ignore [missing-import]

from memory.memory_manager import update_memory
from actions.device_control import device_control
from actions.screen_control import screen_control
from actions.list_inventory import list_inventory
from rag import knowledge_search


class ToolRunnerMixin:
    """Running the tools the model or fast path asks for (devices, screens, visuals, knowledge)."""

    def tool_log(self, text: str):
        text = (text or "").strip()
        if text:
            self.ui.write_log(f"TRAVIS: {text}")

    def speak_error(self, tool_name: str, error: str):
        short = str(error)[:120]
        self.ui.write_log(f"ERR: {tool_name} — {short}")
        self.speak(f"{tool_name} encountered an error. {short}")

    def _handle_show_visual(self, args: dict) -> str:
        """Drive the on-screen visual panel for AI-explained content.

        action 'show' builds/replaces the card; 'next'/'prev' move the on-screen
        highlight in sync with narration; 'clear' returns the screen to the HUD.
        """
        action = (args.get("action") or "show").lower().strip()

        if action == "clear":
            self._visual_card = None
            self._visual_index = 0
            self.ui.clear_visual()
            return "Visual cleared."

        if action in ("next", "prev"):
            card = self._visual_card
            if not card or card.get("kind") != "steps":
                return "There's no step-by-step visual to navigate."
            n = len(card.get("steps") or [])
            if n == 0:
                return "There are no steps to navigate."
            if action == "next":
                self._visual_index = min(self._visual_index + 1, n - 1)
            else:
                self._visual_index = max(self._visual_index - 1, 0)
            card["index"] = self._visual_index
            self.ui.show_visual(card)
            return f"Showing step {self._visual_index + 1} of {n}."

        # action == "show" (default): build a fresh card.
        image = args.get("image_url") or args.get("image_path")
        if image:
            card = {
                "kind": "image",
                "title": args.get("title") or "TRAVIS",
                "caption": args.get("caption") or "",
            }
            if args.get("image_path"):
                card["path"] = args["image_path"]
            if args.get("image_url"):
                card["url"] = args["image_url"]
            self._visual_card = card
            self._visual_index = 0
            self.ui.show_visual(card)
            return "Showing the image on screen."

        steps = args.get("steps") or []
        if not steps:
            return "Nothing to show. Provide steps or an image for the visual."
        card = {
            "kind": "steps",
            "title": args.get("title") or "TRAVIS",
            "steps": [dict(s) for s in steps],
            "index": 0,
        }
        self._visual_card = card
        self._visual_index = 0
        self.ui.show_visual(card)
        return f"Showing a {len(steps)}-step visual on screen. Say 'next' to advance as you explain."

    async def _run_tool(self, name: str, args: dict) -> str:
        """Run one of the non-device tools (knowledge, inventory, visuals, memory, shutdown); its result text."""
        args = dict(args or {})

        print(f"[Voice Agent] 🔧 {name}  {args}")
        tool_start = time.monotonic()
        if self._wake_engaged_at is not None:
            # Reported once per wake, on whichever tool call happens first —
            # includes however long the user spent actually talking, not
            # just system overhead, so treat it as a rough end-to-end number
            # rather than a pure latency measurement.
            since_wake_ms = (tool_start - self._wake_engaged_at) * 1000
            print(
                f"[Voice Agent] ⏱️  {since_wake_ms:.0f}ms since wake word (includes your speech)"
            )
            self._wake_engaged_at = None
        self.ui.set_state("THINKING")
        if name == "save_memory":
            category = args.get("category", "notes")
            key = args.get("key", "")
            value = args.get("value", "")
            if key and value:
                update_memory({category: {key: {"value": value}}})
                print(f"[Memory] 💾 save_memory: {category}/{key} = {value}")
            if not self.ui.muted:
                self.ui.set_state("LISTENING")
            return "ok"

        loop = asyncio.get_event_loop()
        result = "Done."

        try:
            self._tool_active += 1
            try:
                if name == "knowledge_search":
                    query = args.get("query", "")
                    r = await loop.run_in_executor(
                        None, lambda: knowledge_search(query)
                    )
                    result = r or "No relevant information found."

                elif name == "list_inventory":
                    r = await loop.run_in_executor(None, lambda: list_inventory(args))
                    result = r or "Done."

                elif name == "show_visual":
                    result = self._handle_show_visual(args)

                elif name == "device_control":
                    self._timing.setdefault("cms_request_started", time.monotonic())
                    r = await loop.run_in_executor(
                        None,
                        lambda: device_control(
                            parameters=args, player=self.ui, speak=self.tool_log
                        ),
                    )
                    self._timing["cms_response_received"] = time.monotonic()
                    result = r or "Done."

                elif name == "screen_control":
                    self._timing.setdefault("cms_request_started", time.monotonic())
                    r = await loop.run_in_executor(
                        None,
                        lambda: screen_control(
                            parameters=args, player=self.ui, speak=self.tool_log
                        ),
                    )
                    self._timing["cms_response_received"] = time.monotonic()
                    result = r or "Done."

                elif name == "shutdown_travis":
                    self.ui.write_log("SYS: Shutdown requested.")
                    self.speak("Goodbye.")

                    def _shutdown():
                        time.sleep(1)
                        self._release_wake_word()
                        os._exit(0)

                    threading.Thread(target=_shutdown, daemon=True).start()
                else:
                    result = f"Unknown tool: {name}"
            finally:
                self._tool_active -= 1

        except Exception as e:
            result = f"Tool '{name}' failed: {e}"
            traceback.print_exc()
            self.speak_error(name, e)

        if not self.ui.muted:
            self.ui.set_state("LISTENING")

        tool_elapsed_ms = (time.monotonic() - tool_start) * 1000
        print(f"[Voice Agent] ⏱️  {name} took {tool_elapsed_ms:.0f}ms")
        print(f"[Voice Agent] 📤 {name} → {str(result)[:80]}")

        return str(result)
