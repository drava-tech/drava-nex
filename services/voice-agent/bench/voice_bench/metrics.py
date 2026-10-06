"""Small, dependency-free metric helpers: WER, percentiles, rates."""

from __future__ import annotations

import math
import re

_NUM_WORDS = {
    "zero": "0", "oh": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5", "six": "6", "seven": "7",
    "eight": "8", "nine": "9", "ten": "10", "eleven": "11", "twelve": "12", "thirteen": "13", "fourteen": "14",
    "fifteen": "15", "sixteen": "16", "seventeen": "17", "eighteen": "18", "nineteen": "19",
}
_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}


def words(text: str) -> list[str]:
    """Lowercase words with numbers as digits ("twenty four" and "24" are the same word),
    so WER measures what was said, not how a number was written."""
    t = re.sub(r"%", " percent ", text.lower())
    t = re.sub(r"°c?", " degrees ", t)
    raw = re.sub(r"[^a-z0-9\s]", " ", t).split()
    out: list[str] = []
    i = 0
    while i < len(raw):
        w = raw[i]
        if w in _TENS:
            nxt = _NUM_WORDS.get(raw[i + 1]) if i + 1 < len(raw) else None
            if nxt and 1 <= int(nxt) <= 9:
                out.append(str(_TENS[w] + int(nxt)))
                i += 2
                continue
            out.append(str(_TENS[w]))
        elif w == "hundred" and out and out[-1] in ("1", "a"):
            out[-1] = "100"
        else:
            out.append(_NUM_WORDS.get(w, w))
        i += 1
    return out


def edit_ops(ref: list[str], hyp: list[str]) -> tuple[int, int, int]:
    """(substitutions, deletions, insertions) of a minimal word alignment."""
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            d[i][j] = min(d[i - 1][j - 1] + cost, d[i - 1][j] + 1, d[i][j - 1] + 1)
    i, j, s, dl, ins = n, m, 0, 0, 0
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + (0 if ref[i - 1] == hyp[j - 1] else 1):
            s += 0 if ref[i - 1] == hyp[j - 1] else 1
            i, j = i - 1, j - 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            dl += 1
            i -= 1
        else:
            ins += 1
            j -= 1
    return s, dl, ins


def wer(ref: str, hyp: str) -> tuple[float, int, int, int, int]:
    """(WER, substitutions, deletions, insertions, reference words)."""
    r, h = words(ref), words(hyp)
    s, dl, ins = edit_ops(r, h)
    return ((s + dl + ins) / len(r) if r else 0.0), s, dl, ins, len(r)


def corpus_wer(pairs: list[tuple[str, str]]) -> float:
    errors = total = 0
    for ref, hyp in pairs:
        _, s, dl, ins, n = wer(ref, hyp)
        errors += s + dl + ins
        total += n
    return errors / total if total else 0.0


_NUMBER = re.compile(r"\d+")


def numbers(text: str) -> list[str]:
    return _NUMBER.findall(" ".join(words(text)))


def critical_errors(ref: str, hyp: str, keep_words: tuple[str, ...] = ("tusker", "edge", "l1", "l2", "l3", "ac")) -> dict:
    """Errors that change a device command: a number that differs, or a device word that was lost."""
    r_nums, h_nums = numbers(ref), numbers(hyp)
    rw, hw = set(words(ref)), set(words(hyp))
    # "L 1" and "L1" are the same device word
    rw |= {"".join(p) for p in zip(words(ref), words(ref)[1:]) if p[0] in ("l", "el", "ll") and p[1].isdigit()}
    hw |= {"".join(p) for p in zip(words(hyp), words(hyp)[1:]) if p[0] in ("l", "el", "ll") and p[1].isdigit()}
    return {
        "number_changed": r_nums != h_nums,
        "device_word_lost": [w for w in keep_words if w in rw and w not in hw],
    }


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    v = sorted(values)
    k = (len(v) - 1) * p / 100
    lo, hi = math.floor(k), math.ceil(k)
    return v[lo] if lo == hi else v[lo] + (v[hi] - v[lo]) * (k - lo)


def latency_summary(values: list[float]) -> dict:
    vals = [x for x in values if x is not None]
    if not vals:
        return {"n": 0}
    return {
        "n": len(vals), "mean": round(sum(vals) / len(vals)), "p50": round(percentile(vals, 50)),
        "p95": round(percentile(vals, 95)), "p99": round(percentile(vals, 99)), "max": round(max(vals)),
    }


def rate(hits: int, total: int) -> float | None:
    return None if total == 0 else round(hits / total, 4)


def poisson_upper_95(events: int, hours: float) -> float:
    """Upper 95% bound on events/hour. Zero events -> the 'rule of three' (3/T)."""
    if hours <= 0:
        return float("nan")
    if events == 0:
        return 3.0 / hours
    # Wilson-Hilferty approximation of the exact Poisson upper limit
    return (events + 1.96 * math.sqrt(events) + 1.92) / hours
