"""Text helpers: speakable text for TTS and Whisper's device-name vocabulary."""

from __future__ import annotations

import re

from nlu.spoken_names import HIDDEN_FROM_LISTS, say_names


# pyrefly: ignore [missing-import]



_MARKDOWN = re.compile(r"[*_#`>|]+")

# The company's name, which visitors ask about all the time. Whisper has no way to know it: replayed
# on the user's own clips it wrote "white tissue", "white vest", "whitest cove", "White Dusk Door".
# As hotwords plus a sentence in the fallback names prompt, 5 of 6 such clips came out "White Tusker"
# (the recordings without the name were unchanged). Added whatever stt_hotwords says.
COMPANY_HOTWORDS = ("tusker", "white tusker")
COMPANY_SENTENCE = "White Tusker."


def speakable(text: str) -> str:
    """LLM text as the TTS voice should get it: no markdown symbols."""
    return re.sub(r"[ \t]+", " ", _MARKDOWN.sub(" ", text))


def _spoken_light_names(registry, include_halves: bool = False) -> list[str]:
    """The lights as visitors say them (nlu/spoken_names.py): cove light, sky light; with the front and
    back sky lights too when include_halves (they can be asked for explicitly)."""
    keys = list((registry.slots.get("light") or {}).get("values", {}).keys())
    return [say_names(k) for k in keys if include_halves or k not in HIDDEN_FROM_LISTS]


def stt_names_prompt(registry, cfg: dict) -> str:
    """The plain prompt (wake phrase, then the room's names): the fallback when the command-shaped
    prompt from stt_vocabulary() is unsure. It handles short replies ("Hi", "tusker edge") and
    ordinary sentences better; the command prompt handles full commands better."""
    names = _spoken_light_names(registry, include_halves=True)
    names += list((registry.slots.get("screenAlias") or {}).get("values", {}).keys())
    phrase = str(cfg.get("wake_word_phrase") or "hey travis").title()
    base = f"{phrase}. " + ", ".join(names) + "." if names else f"{phrase}."
    return f"{base} {COMPANY_SENTENCE}"


def stt_vocabulary(registry, cfg: dict) -> tuple[str, str]:
    """(initial_prompt, hotwords) that make Whisper write the room's device names right.

    Measured on synthetic speech: with neither, "tusker L3" came out as "Tuscalel 3" /
    "Tesco L1" and a device word was lost in 33 of 128 clips; the prompt (names listed
    after "Hey Travis") plus hotwords="tusker L3" cut that to 4 with no number changed
    and no effect on other speech. Hotwords alone, or a long hotword list, raised the
    error rate and once looped ("tusker edge" x40), so the prompt carries the names.
    Built from the names in config/commands.json so it follows the room.

    2026-10-06, real clips of the user's voice with the small model: the bare names list left
    "turn off tusker edge" heard as "turn off the switch" / "turn off the screen" (hotwords are
    only extra context text, a soft hint). Written as sample COMMANDS the same prompt fixed those
    and about 15 other clips ("250%" -> "50 percent", "tun on" -> "turn on", "unloade the door" ->
    "unlock the door"). Its costs, and what keeps them safe: (1) it can turn mumbles into a
    plausible command, so Whisper's own confidence gates what runs (stt_min_logprob, see
    agent/local.py); (2) no lock/unlock and no AC temperature in it, because Whisper echoed
    those on near-silence; (3) it needs a plain "Turn on the AC" sentence, or "turn on the AC"
    comes out as "turn on <a light>"."""
    names: list[str] = []
    for slot in ("light", "screenAlias"):
        names += list((registry.slots.get(slot) or {}).get("values", {}).keys())
    lights = _spoken_light_names(registry)  # ["cove light", "sky light"]: what visitors say
    phrase = str(cfg.get("wake_word_phrase") or "hey travis").title()
    prompt = cfg.get("stt_initial_prompt")
    if prompt is None:
        sentences = [f"{phrase}."]
        if lights:
            sentences.append(f"Turn off {lights[0]}.")
        sentences.append("Turn on the AC.")
        if len(lights) > 1:
            sentences.append(f"Turn on {lights[1]}.")
        sentences.append(f"Set {lights[0] if lights else 'the light'} to 50 percent.")
        prompt = " ".join(sentences) if lights else (f"{phrase}. " + ", ".join(names) + "." if names else f"{phrase}.")
    hot = cfg.get("stt_hotwords")
    if hot is None:
        hot = "tusker L3" if "tusker L3" in names else ""
    have = {h.strip().lower() for h in hot.split(",")}
    extra = [w for w in COMPANY_HOTWORDS if w not in have]
    if extra:
        hot = ", ".join(([hot] if hot else []) + extra)
    return prompt, hot
