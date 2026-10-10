"""Sentences out of a stream of text, for speaking a knowledge answer as it is written (agent/knowledge_answer.py).

`SentenceSplitter.feed(chunk)` returns the sentences that are complete so far; `finish()` returns what is left. A sentence ends at . ! or ?
followed by whitespace and then the start of another sentence, so the end is only known one character late. It does NOT end:

    * inside a number or an address ("2.5 metres", "thewhitetusker.com": no whitespace after the dot)
    * after a common abbreviation ("e.g.", "i.e.", "Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "St.", "vs.", "etc.", "a.m.", "p.m.", "Inc.", "Ltd.", "No.")
    * after an initial ("Naveen D. C. Parikh", "J. K. Rowling": one capital letter, then the dot)

`merge_short` joins a sentence of fewer than `MIN_WORDS` words to the one after it (not the last one), so the grounding check sees enough words.
"""

from __future__ import annotations

import re

MIN_WORDS = 6
_ABBREVIATIONS = frozenset(
    "e.g. i.e. mr. mrs. ms. dr. prof. st. vs. etc. a.m. p.m. inc. ltd. no. approx. fig. jr. sr.".split()
)
_INITIAL = re.compile(r"^[A-Z]\.$")
_END = re.compile(r"[.!?][\"')\]]*\s+(?=\S)")


def _is_boundary(text: str, end: int) -> bool:
    """`text[:end]` ends with . ! or ? (and closing quotes) followed by whitespace: is it really the end of a sentence?"""
    chunk = text[:end].rstrip()
    if chunk.endswith(("!", "?")) or re.search(r"[!?][\"')\]]*$", chunk):
        return True
    last = chunk.split()[-1] if chunk.split() else ""
    bare = last.strip("\"'()[]")
    if bare.lower() in _ABBREVIATIONS or _INITIAL.match(bare) or re.search(r"(?:^|\s)(?:[a-z]\.){2,}$", " " + bare.lower()):
        return False
    return True


class SentenceSplitter:
    def __init__(self) -> None:
        self._buf = ""

    def feed(self, chunk: str) -> list[str]:
        self._buf += chunk
        out: list[str] = []
        pos = 0
        for m in _END.finditer(self._buf):
            if _is_boundary(self._buf[pos:m.end()], m.end() - pos):
                out.append(self._buf[pos:m.end()].strip())
                pos = m.end()
        self._buf = self._buf[pos:]
        return out

    def finish(self) -> list[str]:
        rest, self._buf = self._buf.strip(), ""
        return [rest] if rest else []


def split(text: str) -> list[str]:
    s = SentenceSplitter()
    return s.feed(text) + s.finish()


def word_count(sentence: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", sentence))


def merge_short(sentences: list[str], min_words: int = MIN_WORDS) -> list[str]:
    """Each sentence of fewer than `min_words` words is joined to the one after it, unless it is the last."""
    out: list[str] = []
    carry = ""
    for i, s in enumerate(sentences):
        s = f"{carry} {s}".strip()
        carry = ""
        if word_count(s) < min_words and i < len(sentences) - 1:
            carry = s
            continue
        out.append(s)
    return out
