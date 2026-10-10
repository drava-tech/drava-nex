"""Reading a streamed `{"found": bool, "answer": string}` as it arrives (agent/knowledge_answer.py).

The model is asked, with Ollama's structured output, to say FIRST whether the knowledge answers (`found`) and only then write the `answer`. This reads
the stream chunk by chunk: `found` is known as soon as its value arrives (the caller stops generating on false), and the text of `answer` comes out
decoded (\\" \\\\ \\n \\t \\uXXXX, surrogate pairs) as it is written, so it can be cut into sentences before the closing quote exists.

If the model writes `answer` before `found` (the schema asks for the other order), nothing is released until `found` is known.
"""

from __future__ import annotations

import re

_FOUND = re.compile(r'"found"\s*:\s*(true|false)')
_ANSWER_START = re.compile(r'"answer"\s*:\s*"')
_SIMPLE = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}

ANSWER_SCHEMA = {
    "type": "object",
    "properties": {"found": {"type": "boolean"}, "answer": {"type": "string"}},  # "found" first: the model decides before it writes
    "required": ["found", "answer"],
}


class AnswerStream:
    def __init__(self) -> None:
        self._buf = ""
        self._pos: int | None = None  # index in _buf of the next undecoded character of the answer
        self._decoded = 0  # characters of the answer already returned
        self._text = ""  # the answer decoded so far
        self.found: bool | None = None
        self.complete = False  # the closing quote of the answer has arrived

    @property
    def answer(self) -> str:
        return self._text

    def feed(self, chunk: str) -> str:
        """Add raw JSON text; returns the NEW decoded answer text that may be spoken ("" until `found` is true)."""
        self._buf += chunk
        if self.found is None:
            m = _FOUND.search(self._buf)
            if m:
                self.found = m.group(1) == "true"
        if self._pos is None:
            m = _ANSWER_START.search(self._buf)
            if m:
                self._pos = m.end()
        if self._pos is not None and not self.complete:
            self._decode()
        if self.found is not True:
            return ""
        out = self._text[self._decoded:]
        self._decoded = len(self._text)
        return out

    def _decode(self) -> None:
        buf, i = self._buf, self._pos
        assert i is not None
        while i < len(buf):
            ch = buf[i]
            if ch == '"':
                self.complete, i = True, i + 1
                break
            if ch != "\\":
                self._text += ch
                i += 1
                continue
            if i + 1 >= len(buf):
                break  # the escape is split across chunks: wait for the rest
            nxt = buf[i + 1]
            if nxt in _SIMPLE:
                self._text += _SIMPLE[nxt]
                i += 2
            elif nxt == "u":
                if i + 6 > len(buf):
                    break
                try:
                    code = int(buf[i + 2:i + 6], 16)
                except ValueError:
                    self._text += buf[i + 1]  # not an escape: keep the character
                    i += 2
                    continue
                if 0xD800 <= code <= 0xDBFF:  # the first half of a surrogate pair: needs the second
                    if i + 12 > len(buf):
                        break
                    low = buf[i + 6:i + 12]
                    if low.startswith("\\u"):
                        try:
                            second = int(low[2:], 16)
                        except ValueError:
                            second = 0
                        if 0xDC00 <= second <= 0xDFFF:
                            self._text += chr(0x10000 + ((code - 0xD800) << 10) + (second - 0xDC00))
                            i += 12
                            continue
                    self._text += "�"
                    i += 6
                    continue
                self._text += chr(code)
                i += 6
            else:
                self._text += nxt
                i += 2
        self._pos = i
