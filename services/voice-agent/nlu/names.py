"""One way to compare a spoken name with a name in the CMS: experiences, media, screens, devices, modes.

Speech never reproduces a title's punctuation, spacing or capitalisation ("The White Tusker PORT-FOLIO" is heard as "white tusker portfolio", "Dr. Who's Demo
(v2)" as "doctor whos demo v2"), so every comparison goes through `key`: accents folded, "&" read as "and", case ignored, and everything that is not a
letter or a digit removed. Two names are the same name when their keys are equal. Nothing here is fuzzy: a number or a letter that differs is a different name
(fuzzy "sounds like" matching stays in nlu/title_match.py, which builds on this).

    key(text)                 "The White Tusker PORT-FOLIO" -> "whitetuskerportfolio"
    same(a, b)                equal keys
    resolve(spoken, names)    the ONE real name the spoken one means (equal keys, else a unique containment), or None
"""

from __future__ import annotations

import re
import unicodedata

MIN_CONTAINED = 4  # a spoken name shorter than this ("tv") is never "contained" in a longer title
_LEADING_ARTICLE = re.compile(r"^the[^a-z0-9]+", re.I)  # only "the": "A-B" and "A Day in the Life" keep their "a"


def fold(text: str) -> str:
    """Lowercase, accents removed ("Café" -> "cafe"), "&" and "+" as "and", typographic quotes and dashes as plain ones."""
    t = unicodedata.normalize("NFKD", str(text or ""))
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    t = t.replace("&", " and ").replace("+", " and ")
    return t.casefold()


def key(text: str, drop_article: bool = True) -> str:
    """Letters and digits only, in order. A leading "the" is dropped unless `drop_article` is False."""
    t = fold(text).strip()
    if drop_article:
        t = _LEADING_ARTICLE.sub("", t)
    return re.sub(r"[^a-z0-9]", "", t)


def same(a: str, b: str) -> bool:
    ka = key(a)
    return bool(ka) and ka == key(b)


def resolve(spoken: str, names: list[str]) -> str | None:
    """The real name `spoken` means: the one name with the same key, else the one name of which the spoken words are a run of whole words (at least MIN_CONTAINED letters). Two candidates is no answer (None): the caller asks. Digits are part of the key, so "reel 2025" is never "reel 2024"."""
    ks = key(spoken)
    if not ks:
        return None
    exact = {n for n in names if n and key(n) == ks}
    if len(exact) == 1:
        return next(iter(exact))
    if exact:
        return None
    near = set()
    for n in names:
        kn = key(n)
        if not kn:
            continue
        said_digits = re.findall(r"\d+", ks)
        if said_digits and said_digits != re.findall(r"\d+", kn):
            continue  # a number said must be the title's number
        if len(ks) < len(kn) and _inside(ks, n):  # said LESS than the title: a part of it. Extra words said are never ignored.
            near.add(n)
    return next(iter(near)) if len(near) == 1 else None


def _inside(short_key: str, long_text: str) -> bool:
    """Is `short_key` a run of WHOLE words of `long_text` (word breaks as written, punctuation ignored, so "portfolio" is inside "The White Tusker
    PORT-FOLIO" but "mountain flows" is not inside "Mountain Flow": a different word is a different name, and sounds-like guesses are asked about)?"""
    if len(short_key) < MIN_CONTAINED:
        return False
    parts = [p for p in re.split(r"[^a-z0-9]+", fold(long_text)) if p]  # "port-folio" is two pieces, so "portfolio" is the run of both
    for i in range(len(parts)):
        run = ""
        for j in range(i, len(parts)):
            run += parts[j]
            if run == short_key:
                return True
            if len(run) >= len(short_key):
                break
    return False
