"""Text helpers: speakable text for TTS and Whisper's device-name vocabulary."""

from __future__ import annotations

import re


# pyrefly: ignore [missing-import]



_MARKDOWN = re.compile(r"[*_#`>|]+")


def speakable(text: str) -> str:
    """LLM text as the TTS voice should get it: no markdown symbols."""
    return re.sub(r"[ \t]+", " ", _MARKDOWN.sub(" ", text))


def stt_vocabulary(registry, cfg: dict) -> tuple[str, str]:
    """(initial_prompt, hotwords) that make Whisper write the room's device names right.

    Measured on synthetic speech: with neither, "tusker L3" came out as "Tuscalel 3" /
    "Tesco L1" and a device word was lost in 33 of 128 clips; the prompt (names listed
    after "Hey Travis") plus hotwords="tusker L3" cut that to 4 with no number changed
    and no effect on other speech. Hotwords alone, or a long hotword list, raised the
    error rate and once looped ("tusker edge" x40), so the prompt carries the names.
    Built from the names in config/commands.json so it follows the room."""
    names: list[str] = []
    for slot in ("light", "screenAlias"):
        names += list((registry.slots.get(slot) or {}).get("values", {}).keys())
    phrase = str(cfg.get("wake_word_phrase") or "hey travis").title()
    prompt = cfg.get("stt_initial_prompt")
    if prompt is None:
        prompt = f"{phrase}. " + ", ".join(names) + "." if names else f"{phrase}."
    hot = cfg.get("stt_hotwords")
    if hot is None:
        hot = "tusker L3" if "tusker L3" in names else ""
    return prompt, hot
