"""What TRAVIS is allowed to say about an action (local backend).

The rule: it never confirms something it did not do. Two parts.

1. After a tool runs, the confirmation is built from the tool's own result,
   not from the model's wording (`compose`). A result is true by construction:
   "Door unlocked." can only be said if the CMS said so, and a refusal is
   spoken as a refusal. The model is not asked to paraphrase it, which also
   saves a whole extra LLM round (~1 s) per action. Only results that need
   interpretation (knowledge_search) go back to the model.
2. A reply with no tool behind it must not claim an action or a device state
   (`claims_action`): "Turned off 3 lights" or "I'll increase the brightness"
   after zero tool calls is replaced by `unverified_reply`.

Public API:
    ToolResult
    compose(results, wake_hint) -> str | None   spoken text, or None if a model must write it
    claims_action(text) -> bool
    clean_cms_message(text) -> str
    unverified_reply(wake_hint) -> str
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from nlu.spoken_names import say_names


@dataclass
class ToolResult:
    name: str
    args: dict
    ok: bool
    message: str
    extra: dict = field(default_factory=dict)

    @property
    def is_action(self) -> bool:
        """Changes the room (as opposed to reading it)."""
        if self.name in ("device_control", "screen_control"):
            return str(self.args.get("action", "")).lower() != "status"
        return self.name in ("show_visual",)


# Tools whose result is already a sentence to say as it stands.
_SELF_EXPLAINING = {"device_control", "screen_control", "list_inventory", "show_visual"}
_SILENT = {"save_memory"}


def clean_cms_message(text: str) -> str:
    """The CMS's wording minus the instruction aimed at a model ("Only offer these.")."""
    text = re.sub(r"\s*Only offer these\.?", "", text or "").strip()
    if text.rstrip(".").lower() == "invalid request":
        return "I couldn't make sense of that request, so I didn't change anything."
    return text


def _confirmation(r: ToolResult) -> str:
    """A short spoken confirmation for a successful action, from the result."""
    a = r.args or {}
    if r.name == "device_control" and str(a.get("action", "")).lower() == "ac_command":
        cmd = str(a.get("command", "")).lower()
        params = a.get("params") or {}
        if cmd == "power_on":
            return "The AC is on."
        if cmd == "power_off":
            return "The AC is off."
        if cmd == "set_temp" and isinstance(params.get("temp"), (int, float)):
            return f"AC set to {int(params['temp'])} degrees."
        if cmd == "set_mode" and params.get("mode"):
            return f"AC set to {params['mode']} mode."
        if cmd == "set_fan" and params.get("fan"):
            return f"AC fan set to {params['fan']}."
        if cmd == "power" and not params:
            return "Pressed power on the TV."
    return clean_cms_message(r.message)


def compose(results: list[ToolResult], wake_hint: str = "Hey Travis") -> str | None:
    """The spoken reply for this round of tool results, or None when the model has to
    write it (a result like knowledge_search needs interpreting)."""
    if not results:
        return None
    if any(r.name not in _SELF_EXPLAINING and r.name not in _SILENT for r in results):
        return None
    parts: list[str] = []
    for r in results:
        if r.name in _SILENT:
            continue
        text = say_names(_confirmation(r) if r.ok else clean_cms_message(r.message))
        if text and text not in parts:
            parts.append(text)
    spoken = " ".join(parts)
    return with_wake_hint(spoken, wake_hint) if spoken else ""


def with_wake_hint(text: str, wake_hint: str = "Hey Travis") -> str:
    """The mic closes after each exchange, so a question must say how to answer it."""
    text = text.strip()
    # "?" anywhere: a question is usually followed by the list of options to pick from.
    if "?" in text and wake_hint.lower() not in text.lower():
        return f"{text} Say {wake_hint}, then your answer."
    return text


# ─── claims about actions / state, for replies with no tool behind them ───

_PERFORMED = re.compile(
    r"\b(done|turned (?:on|off|up|down)|is now|are now|has been|have been|set to|is on|is off|are on|are off|"
    r"unlocked|locked|pushed|all set|switched|sent|stopped|paused|playing|dimmed|brightened|lowered|raised)",
    re.I,
)
_PROMISED = re.compile(
    r"\b(i'?ll|i will|i'?ve|i have|let me|i'?m going to|going to|i'?m)\s+"
    r"(increase|decrease|turn|turning|set|setting|lock|locking|unlock|unlocking|dim|dimming|switch|switching|raise|lower|adjust|adjusting|change|changing|make|making|"
    r"open|opening|close|closing|mute|play|playing|stop|stopping|pause|pausing|brighten|brightening|push|pushing)",
    re.I,
)
_NOT_DONE = re.compile(
    r"(couldn'?t|could not|can'?t|cannot|didn'?t|did not|unable|failed|not (?:able|sure)|don'?t|haven'?t|"
    r"no such|which|what|\?|couldn’t|can’t|didn’t|don’t|haven’t)",
    re.I,
)


_CONTACT_SENTENCE = re.compile(r"thewhitetusker|@|\bhello at\b|\b(?:reach us|e-?mail|phone|call us|contact us)\b", re.I)


def without_contact(text: str) -> str:
    """`text` minus any sentence giving contact details. The company's contact line belongs to answers about the company only: the
    model adds it to answers about the CMS or Travis however it is told not to, so it is removed here, not just asked for."""
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return " ".join(s for s in sentences if not _CONTACT_SENTENCE.search(s)).strip()


_STOP = frozenset("the a an and or of to in on at for with is are was were be been it its this that these those we our us you your they their them as by from not "
                  "but so can will would could should do does did have has had i he she his her there here what which who how about into than then also just".split())


def grounding(answer: str, knowledge: str, also_known: str = "") -> float:
    """Share of the answer's content words that also occur in `knowledge`: 1.0 for a paraphrase that keeps its facts, low for an
    answer that brings in things the knowledge never said. A cheap check, not a proof: it cannot tell a wrong combination of true words.
    `also_known`: words that count as known as well (the visitor's own question: an answer that echoes "worked" back is not inventing it).
    Names and numbers are NOT helped by this; see `unsupported_facts`."""
    words = [w for w in re.findall(r"[a-z]+", (answer or "").lower()) if w not in _STOP and len(w) > 3]
    if not words:
        return 1.0
    known = set(re.findall(r"[a-z]+", (knowledge or "").lower())) | set(re.findall(r"[a-z]+", (also_known or "").lower()))
    return sum(w in known for w in words) / len(words)


_NUMBER_WORDS = {w: str(i) for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split())}
_NUMBER_WORDS.update({"thirty": "30", "forty": "40", "fifty": "50", "sixty": "60", "seventy": "70", "eighty": "80", "ninety": "90",
                      "hundred": "100", "thousand": "1000", "million": "1000000", "billion": "1000000000"})
_NUMBER_WORDS.pop("one")  # "one studio", "one of the": an article far more often than a quantity
_NUMBER_TOKEN = re.compile(r"\d[\d,]*(?:\.\d+)?")
# Capitalised words that are not names: sentence openers and the like
_OPENERS = frozenset(
    "yes no sure absolutely certainly indeed unfortunately however also additionally currently generally typically today here there they them "
    "their these those this that what which who when where why how our we you your it its the a an and or but so if as at by for from in of on to with "
    "each every all some any many most more both either neither operators visitors please thanks okay ok hello hi hey one two three four five six "
    "seven eight nine ten first second third next finally overall instead because since while whether once ask say just simply let using use without through "
    "during after before between across within until still even only often usually sometimes always never anyone someone everyone nothing anything something "
    "ensure make can could may might should would will shall do does did is are was were be been being has have had not nor yet than then thus hence "
    "together beyond among around along per via like such other another own same few several various multiple whether".split())


# The company, the assistant and the room's own vocabulary are not new facts whichever section was retrieved.
_ALWAYS_KNOWN = frozenset("white tusker travis cms ac tv".split())


def _numbers_in(text: str) -> set[str]:
    out = {n.replace(",", "").rstrip(".") for n in _NUMBER_TOKEN.findall(text or "")}
    out |= {_NUMBER_WORDS[w] for w in re.findall(r"[a-z]+", (text or "").lower()) if w in _NUMBER_WORDS}
    return out


def _names_in(text: str, question: str = "") -> set[str]:
    """Capitalised words that look like names (proper nouns, companies, projects, acronyms), lower-cased. A word that only starts the sentence ("Founded in
    1990") is a name only if it is not an ordinary opener AND something else says it is one: it is written capitalised in the middle of the visitor's
    question or of the sentence, or it is an acronym or has a digit. (A new name that only ever starts a sentence is left to the overlap score.)"""
    names: set[str] = set()
    elsewhere = {w.lower() for w in re.findall(r"(?<!^)(?<![.!?]\s)(?<![A-Za-z0-9])([A-Z][A-Za-z0-9&'-]+)", question or "")}
    elsewhere |= {w.lower() for w in re.findall(r"(?<=[a-z,;] )([A-Z][A-Za-z0-9&'-]+)", text or "")}
    for sentence in re.split(r"(?<=[.!?])\s+", (text or "").strip()):
        tokens = re.findall(r"[A-Za-z][A-Za-z0-9&'\u2019-]*", sentence)
        for i, tok in enumerate(tokens):
            word = tok.replace("\u2019", "'")
            word = re.sub(r"'s$", "", word)
            if len(word) < 2 or not word[0].isupper():
                continue
            if i == 0 and (word.lower() in _OPENERS or not (word.lower() in elsewhere or word.isupper() or any(ch.isdigit() for ch in word))):
                continue
            if word.lower() in _OPENERS and not word.isupper():
                continue
            names.add(word.lower())
    return names


def unsupported_facts(text: str, knowledge: str, question: str = "") -> list[str]:
    """Names and numbers in `text` that the retrieved `knowledge` does not contain, whatever the overlap score: the visitor's words never vouch for
    them ("Did you win a Nobel Prize" must not be answered with a Nobel Prize, "500 employees" with 500). Case-insensitive; a number counts as the
    same in digits or words."""
    known_words = set(re.findall(r"[a-z0-9&'-]+", (knowledge or "").lower().replace("\u2019", "'")))
    known_words |= {re.sub(r"'s$", "", w) for w in known_words}
    known_numbers = _numbers_in(knowledge)
    missing = sorted(n for n in _names_in(text, question) if n not in known_words and n not in _ALWAYS_KNOWN)
    missing += sorted(n for n in _numbers_in(text) if n not in known_numbers)
    return missing


_NEGATION = re.compile(r"\b(?:not|no|never|none|cannot|nothing|nobody|neither|nor|without)\b|n['\u2019]t\b", re.I)


def has_negation(text: str) -> bool:
    """not, no, never, none, cannot, n't forms... A sentence that denies something must stand on the knowledge alone."""
    return bool(_NEGATION.search(text or ""))


def check_sentence(text: str, knowledge: str, question: str = "") -> tuple[float, list[str]]:
    """(grounding score, names/numbers the knowledge lacks) for one sentence of an answer. The visitor's own words count as known, EXCEPT in a sentence
    that contains a negation: "Travis does not run the company's operations" is not vouched for by a question about the company's operations."""
    g = grounding(text, knowledge, also_known="" if has_negation(text) else question)
    return g, unsupported_facts(text, knowledge, question)


def claims_action(text: str) -> bool:
    """True if the text says an action happened or is happening, or states a device
    state as fact — with no admission, question or refusal in it."""
    t = text or ""
    return bool(_PERFORMED.search(t) or _PROMISED.search(t)) and not _NOT_DONE.search(t)


_UNIT_NUMBER = re.compile(r"(\d+(?:\.\d+)?)\s*(?:%|percent|degrees?)", re.I)


def invents_number(text: str, said: set[float]) -> bool:
    """True if the text puts a level or temperature in the user's mouth: "I'll dim it to
    30%" after they said "reduce 70%". A number that wasn't said is never confirmed."""
    return any(float(n) not in said for n in _UNIT_NUMBER.findall(text or ""))


def unverified_reply(wake_hint: str = "Hey Travis") -> str:
    return f"I haven't changed anything yet. What would you like me to do, and on which device? Say {wake_hint}, then your request."
