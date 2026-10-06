"""Live-voice STT diagnostic. Speak real commands; see exactly what the STT path hears.

    python -m bench.stt_diag inspect              audio/VAD/STT configuration, as the agent would use it
    python -m bench.stt_diag run [--set commands] spoken command set (default), then a report
    python -m bench.stt_diag run --set conditions same commands under distance/noise/echo/overlap conditions
    python -m bench.stt_diag run --set all
    python -m bench.stt_diag report <session dir> rebuild report.md from results.jsonl

Read-only with respect to production: it never calls the CMS, device APIs, the LLM or TTS, and it changes
no config. It opens the mic itself, so STOP THE AGENT FIRST (one process per mic and GPU).

The capture path mirrors agent/mic_listener.py (16 kHz, mono, int16, 1024-sample blocks, same device lookup)
and the cut mirrors agent/local.py (speech/vad.py Endpointer with the same config keys). Per take it keeps
  prod     what the agent would send to Whisper: each VAD segment, transcribed with the production decode
  novocab  same audio, no initial_prompt/hotwords           -> is the vocabulary helping or hurting?
  beam5    same audio, beam_size=5 (production is 1)         -> is greedy decoding losing words?
  whole    one segment cut with a long end-silence (1.8 s)   -> is the VAD cutting commands apart?
Output: bench/results/stt_diag/<session>/ (gitignored): wavs, results.jsonl, report.md.
"""

from __future__ import annotations

import argparse
import copy
import json
import queue
import re
import sys
import time
import wave
from datetime import datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import settings  # noqa: E402
from settings import CHANNELS, CHUNK_SIZE, SEND_SAMPLE_RATE, load_api_config  # noqa: E402
from speech.vad import FRAME_MS, Endpointer  # noqa: E402

RESULTS_DIR = ROOT / "bench" / "results" / "stt_diag"
WHOLE_END_MS = 1800
NO_SPEECH_TIMEOUT_S = 12.0
SAMPLE_WIDTH = 2

# ── The spoken command set ───────────────────────────────────────────────────
# (id, group, text). Spoken after "Hey Travis," unless --no-wake. Numbers are written the way a person
# says them; scoring turns number words into digits on both sides.
COMMANDS: list[tuple[str, str, str]] = [
    # device names + on/off
    ("dev01", "device", "turn on the AC"),
    ("dev02", "device", "turn off the air conditioner"),
    ("dev03", "device", "switch on the a c"),
    ("dev04", "device", "switch off the lights"),
    ("dev05", "device", "turn on the light"),
    ("dev06", "device", "turn on the TV"),
    ("dev07", "device", "turn off the screen"),
    ("dev08", "device", "switch on the main display"),
    ("dev09", "device", "turn on the audio"),
    ("dev10", "device", "turn off the display"),
    # door
    ("door01", "action", "lock the door"),
    ("door02", "action", "unlock the door lock"),
    # actions
    ("act01", "action", "increase the brightness"),
    ("act02", "action", "decrease the brightness"),
    ("act03", "action", "raise the temperature"),
    ("act04", "action", "lower the temperature"),
    ("act05", "action", "make the lights brighter"),
    ("act06", "action", "make the lights darker"),
    ("act07", "action", "show the video on the screen"),
    ("act08", "action", "open the gallery"),
    ("act09", "action", "play the video"),
    ("act10", "action", "pause the video"),
    # numbers (the dangerous ones)
    ("num20", "number", "set the AC to twenty degrees"),
    ("num22", "number", "set the AC to twenty two degrees"),
    ("num24", "number", "set the AC temperature to twenty four"),
    ("num25", "number", "set the AC to twenty-five degrees"),
    ("num28", "number", "set the AC to twenty eight degrees"),
    ("num30", "number", "set the AC to thirty degrees"),
    ("num40", "number", "set the brightness to forty percent"),
    ("num50", "number", "set the lights to fifty percent"),
    ("num60", "number", "dim the lights to sixty percent"),
    ("num70", "number", "set the brightness to seventy percent"),
    ("num75", "number", "set the lights to seventy five percent"),
    ("num80", "number", "increase the brightness to eighty percent"),
    ("num90", "number", "set the brightness to ninety percent"),
    # multi-action (NOT split here: this tests STT, not the splitter)
    ("multi01", "multi", "set the AC to twenty four and turn the lights on"),
    ("multi02", "multi", "set the temperature to twenty five and increase the brightness to eighty percent"),
    ("multi03", "multi", "turn on the lights and switch on the screen"),
    ("multi04", "multi", "turn off the AC and lower the lights to fifty percent"),
]

# Speaking-style prompts, appended to the matching group so the commands are spoken different ways.
STYLES = [
    "normal speed, natural Indian-English pronunciation",
    "a bit fast",
    "a bit slow",
    "with a short pause in the middle",
    "with a longer pause between the two actions",
    "from about 2 m away",
    "slightly off to the side of the mic",
]

# Conditions A-I (item 4): same few commands repeated under each. The reference is A, else B.
CONDITION_COMMANDS = ["num24", "num75", "num80", "dev03", "multi01", "multi04"]
CONDITIONS: list[tuple[str, str, str]] = [
    ("A", "close", "very close to the mic (about 10 cm)"),
    ("B", "normal", "your normal speaking distance"),
    ("C", "far", "far from the mic (2-3 m)"),
    ("D", "noise", "with background conversation/noise (play a talk or have someone chatter)"),
    ("E", "room_audio", "while room audio is playing (music/TV at normal volume)"),
    ("F", "tts_playing", "while a voice/TTS is playing from the speaker (play one yourself; skip if unsafe)"),
    ("G", "other_speaker", "with another person speaking nearby (they talk while you speak)"),
    ("H", "short_pause", "with a SHORT pause inside the command (about 0.5 s)"),
    ("I", "long_pause", "with a LONG pause between the two actions (about 1.5 s)"),
]
# H and I only make sense for commands with a natural place to pause.
PAUSE_COMMANDS = {"H": ["num24", "multi01", "multi04"], "I": ["multi01", "multi02", "multi04"]}


def build_command_set(light_names: list[str], wake: bool) -> list[dict]:
    items = []
    for i, (cid, group, text) in enumerate(COMMANDS):
        items.append(
            {"id": cid, "group": group, "text": text, "style": STYLES[i % len(STYLES)], "condition": "normal"}
        )
    for n, name in enumerate(light_names[:3]):  # room names from commands.json: tests the vocabulary prompt
        items.append(
            {"id": f"room{n + 1:02d}", "group": "room-name", "text": f"turn on {name}",
             "style": STYLES[n], "condition": "normal"}
        )
    return _with_wake(items, wake)


def build_condition_set(wake: bool) -> list[dict]:
    by_id = {c[0]: c for c in COMMANDS}
    items = []
    for code, cname, how in CONDITIONS:
        ids = PAUSE_COMMANDS.get(code, CONDITION_COMMANDS)
        for cid in ids:
            _, group, text = by_id[cid]
            items.append(
                {"id": f"{cid}@{code}", "base_id": cid, "group": group, "text": text, "style": how,
                 "condition": cname, "condition_code": code}
            )
    return _with_wake(items, wake)


def _with_wake(items: list[dict], wake: bool) -> list[dict]:
    for it in items:
        it["say"] = ("Hey Travis, " if wake else "") + it["text"]
        it["expect_wake"] = wake
    return items


# ── Scoring ──────────────────────────────────────────────────────────────────
_UNITS = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
    "sixteen seventeen eighteen nineteen".split())}
_TENS = {w: 10 * (i + 2) for i, w in enumerate("twenty thirty forty fifty sixty seventy eighty ninety".split())}
_SYNONYMS = [
    (r"\ba[ /.-]?c\b", "ac"),
    (r"\bair conditioner\b", "ac"),
    (r"\bair conditioning\b", "ac"),
    (r"\btelevision\b", "tv"),
    (r"\bt v\b", "tv"),
    (r"%", " percent"),
    (r"\bdegrees? celsius\b", "degrees"),
    (r"°\s*c?", " degrees"),
    (r"\bswitch\b", "turn"),  # "switch on" and "turn on" mean the same command
]
_WAKE = re.compile(r"^\s*(?:hey|hi|a|hay)[ ,.]+travis[ ,.:!]*", re.I)


def words_to_digits(text: str) -> str:
    """'twenty four' / 'twenty-five' / 'seventy five' -> '24' / '25' / '75' (0-100); other text untouched."""
    toks = re.sub(r"-", " ", text.lower()).split()
    out: list[str] = []
    i = 0
    while i < len(toks):
        w = toks[i]
        if w in _TENS:
            val = _TENS[w]
            if i + 1 < len(toks) and toks[i + 1] in _UNITS and 1 <= _UNITS[toks[i + 1]] <= 9:
                val += _UNITS[toks[i + 1]]
                i += 1
            out.append(str(val))
        elif w in _UNITS:
            out.append(str(_UNITS[w]))
        elif w == "hundred" and out and out[-1] == "1":
            out[-1] = "100"
        else:
            out.append(w)
        i += 1
    return " ".join(out)


def normalize(text: str) -> str:
    t = text.lower().strip()
    for pat, rep in _SYNONYMS:
        t = re.sub(pat, rep, t)
    t = words_to_digits(t)
    t = re.sub(r"(\d)\s*(percent)", r"\1 \2", t)
    t = re.sub(r"[^a-z0-9 ]", " ", t)
    t = re.sub(r"\bthe\b", " ", t)  # articles are not a command-level error
    return re.sub(r"\s+", " ", t).strip()


def strip_wake(text: str) -> tuple[str, bool]:
    m = _WAKE.match(text)
    return (text[m.end():], True) if m else (text, False)


def numbers_in(text: str) -> list[str]:
    return re.findall(r"\d+", normalize(text))


def edit_distance(a: list[str], b: list[str]) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def score(expected: str, heard: str) -> dict:
    """WER and the command-critical checks, on normalized text (wake phrase and articles ignored)."""
    heard_cmd, wake_heard = strip_wake(heard)
    ref, hyp = normalize(strip_wake(expected)[0]).split(), normalize(heard_cmd).split()
    wer = edit_distance(ref, hyp) / len(ref) if ref else (0.0 if not hyp else 1.0)
    exp_nums, got_nums = numbers_in(expected), numbers_in(heard_cmd)
    return {
        "wer": round(wer, 3),
        "exact": ref == hyp,
        "numbers_expected": exp_nums,
        "numbers_heard": got_nums,
        "numbers_ok": exp_nums == got_nums,
        "dropped": [w for w in ref if w not in hyp],
        "added": [w for w in hyp if w not in ref],
        "wake_heard": wake_heard,
    }


# ── Audio metrics ────────────────────────────────────────────────────────────
def audio_stats(pcm: bytes, channels: int = 1) -> dict:
    x = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        x = x[: len(x) // channels * channels].reshape(-1, channels).mean(axis=1)
    if x.size == 0:
        return {"seconds": 0.0}
    frame = SEND_SAMPLE_RATE * FRAME_MS // 1000
    n = len(x) // frame
    lv = np.sqrt((x[: n * frame].reshape(n, frame) ** 2).mean(axis=1)) if n else np.array([float(np.sqrt((x**2).mean()))])
    db = lambda v: round(20 * np.log10(max(float(v), 1e-6)), 1)  # noqa: E731
    floor, speech = np.percentile(lv, 10), np.percentile(lv, 90)
    return {
        "seconds": round(len(x) / SEND_SAMPLE_RATE, 2),
        "peak_dbfs": db(np.abs(x).max()),
        "speech_dbfs": db(speech),  # loud 10% of frames ~ speech level
        "noise_dbfs": db(floor),  # quiet 10% of frames ~ room noise
        "snr_db": round(db(speech) - db(floor), 1),
        "clipped_pct": round(float((np.abs(x) > 0.99).mean() * 100), 3),
    }


def save_wav(path: Path, pcm: bytes, channels: int = 1) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(SAMPLE_WIDTH)
        w.setframerate(SEND_SAMPLE_RATE)
        w.writeframes(pcm)


# ── Production configuration, read the way the agent reads it ────────────────
def production_config() -> dict:
    cfg = load_api_config()
    from agent.vocabulary import stt_vocabulary
    from nlu.command_matcher import load_registry

    registry = load_registry(settings.COMMANDS_PATH)
    prompt, hot = stt_vocabulary(registry, cfg)
    return {
        "cfg": cfg, "registry": registry, "prompt": prompt, "hotwords": hot,
        "vad": {
            "aggressiveness": int(cfg.get("vad_aggressiveness", 2)),
            "end_ms": int(cfg.get("vad_end_silence_ms", 500)),
            "max_ms": int(cfg.get("vad_max_utterance_ms", 12000)),
            "start_ms": 90, "preroll_ms": 300, "frame_ms": FRAME_MS,
        },
    }


def make_endpointer(vad: dict, end_ms: int | None = None, max_ms: int | None = None) -> Endpointer:
    return Endpointer(
        sample_rate=SEND_SAMPLE_RATE, aggressiveness=vad["aggressiveness"],
        end_ms=end_ms or vad["end_ms"], max_ms=max_ms or vad["max_ms"],
    )


def load_stt(pc: dict):
    """The same WhisperSTT the agent builds in agent/local.py (_load_stt), model path resolved like audio_bench."""
    from speech.stt import WhisperSTT

    cfg = pc["cfg"]
    model = cfg.get("stt_model", "small")
    if model.startswith("../"):
        model = str((ROOT / model).resolve())
    return WhisperSTT(
        model=model, device=cfg.get("stt_device", "cuda"), compute_type=cfg.get("stt_compute_type", "float16"),
        hotwords=pc["hotwords"], initial_prompt=pc["prompt"], cuda_lib_dir=cfg.get("stt_cuda_lib_dir") or None,
        reject_threshold=float(cfg.get("stt_reject_language_threshold", 0.5)),
        english_floor=float(cfg.get("stt_english_floor", 0.15)),
    )


def variant(stt, **overrides):
    """A shallow copy of the loaded STT with some decode settings changed (the model itself is shared)."""
    v = copy.copy(stt)
    for k, val in overrides.items():
        setattr(v, k, val)
    return v


def input_device_report(hint: str) -> dict:
    import sounddevice as sd

    from audio.devices import resolve_input_device

    idx = resolve_input_device(hint)
    if idx is None:
        idx = sd.default.device[0]
    dev = sd.query_devices(idx)
    host = sd.query_hostapis(dev["hostapi"])["name"]
    return {
        "index": idx, "name": dev["name"], "host_api": host,
        "max_input_channels": dev["max_input_channels"], "native_rate": dev["default_samplerate"],
        "default_low_latency_s": dev["default_low_input_latency"],
    }


def cmd_inspect(_args) -> int:
    pc = production_config()
    cfg = pc["cfg"]
    hint = cfg.get("mic_device_name", "")
    dev = input_device_report(hint)
    lines = [
        "== Audio capture (agent/mic_listener.py) ==",
        f"configured mic_device_name : {hint!r}",
        f"resolved device            : #{dev['index']} {dev['name']} [{dev['host_api']}]",
        f"device max input channels  : {dev['max_input_channels']}   native rate: {dev['native_rate']:.0f} Hz",
        f"agent captures             : {CHANNELS} channel(s), {SEND_SAMPLE_RATE} Hz, int16, blocksize {CHUNK_SIZE} samples "
        f"({CHUNK_SIZE * 1000 / SEND_SAMPLE_RATE:.0f} ms)",
        f"rate mismatch (resampling) : {'YES — PortAudio resamples' if int(dev['native_rate']) != SEND_SAMPLE_RATE else 'no'}",
        "channel loss               : "
        + (f"YES — device has {dev['max_input_channels']} channels, agent uses 1 (PortAudio mix/pick unknown)"
           if dev["max_input_channels"] > 1 else "no (device is mono)"),
        f"speaker extraction (gain)  : {cfg.get('speaker_extraction_enabled')} ({cfg.get('speaker_extraction_backend')}) "
        "— scales audio by voice match BEFORE the VAD in production; not applied in this diagnostic",
        "software DSP in agent       : none (no AGC/denoise/AEC/filter); OS/driver DSP not visible from here",
        "",
        "== VAD / segmentation (speech/vad.py via agent/local.py) ==",
        f"WebRTC aggressiveness {pc['vad']['aggressiveness']}, {FRAME_MS} ms frames, start {pc['vad']['start_ms']} ms voiced, "
        f"end {pc['vad']['end_ms']} ms silence, pre-roll {pc['vad']['preroll_ms']} ms, "
        f"tail kept 200 ms, max utterance {pc['vad']['max_ms']} ms",
        "a pause > end-silence splits a command into SEPARATE utterances, each transcribed independently",
        "",
        "== STT (speech/stt.py) ==",
        f"model {cfg.get('stt_model', 'small')} on {cfg.get('stt_device', 'cuda')}/{cfg.get('stt_compute_type', 'float16')}",
        "language: detect_language pass (reject if confidently non-English) then forced language='en'",
        "decode: beam_size=1, temperature=0.0 (no fallback), condition_on_previous_text=False, "
        "without_timestamps, vad_filter=False, max_new_tokens=24+10*seconds",
        f"initial_prompt: {pc['prompt']!r}",
        f"hotwords: {pc['hotwords']!r}",
        "each utterance is transcribed whole (not in streaming chunks)",
    ]
    print("\n".join(lines))
    return 0


# ── Capture sources ──────────────────────────────────────────────────────────
class MicSource:
    """sd.InputStream into a queue, opened exactly as agent/mic_listener.py opens it."""

    def __init__(self, hint: str, channels: int):
        import sounddevice as sd

        from audio.devices import resolve_input_device

        self.channels = channels
        self.q: queue.Queue[bytes] = queue.Queue()
        self._stream = sd.InputStream(
            device=resolve_input_device(hint), samplerate=SEND_SAMPLE_RATE, channels=channels, dtype="int16",
            blocksize=CHUNK_SIZE, callback=lambda indata, f, t, s: self.q.put(indata.tobytes()),
        )

    def __enter__(self):
        self._stream.start()
        return self

    def __exit__(self, *a):
        self._stream.stop()
        self._stream.close()

    def drain(self) -> None:
        while not self.q.empty():
            self.q.get_nowait()

    def get(self, timeout: float = 0.5) -> bytes | None:
        try:
            return self.q.get(timeout=timeout)
        except queue.Empty:
            return None


def mono(pcm: bytes, channels: int) -> bytes:
    if channels == 1:
        return pcm
    x = np.frombuffer(pcm, dtype=np.int16)
    x = x[: len(x) // channels * channels].reshape(-1, channels).astype(np.float32).mean(axis=1)
    return x.astype(np.int16).tobytes()


def capture_take(src, pc: dict) -> dict:
    """Listen until one command is finished. Returns the raw take, production segments and the whole-utterance cut."""
    prod = make_endpointer(pc["vad"])
    whole = make_endpointer(pc["vad"], end_ms=WHOLE_END_MS, max_ms=15000)
    src.drain()
    raw: list[bytes] = []
    segments: list[bytes] = []
    whole_pcm: bytes | None = None
    started = time.monotonic()
    heard_speech = False
    while True:
        chunk = src.get()
        if chunk is None:
            if time.monotonic() - started > NO_SPEECH_TIMEOUT_S and not heard_speech:
                break
            continue
        raw.append(chunk)
        m = mono(chunk, src.channels)
        segments += prod.feed(m)
        heard_speech = heard_speech or prod.in_speech or bool(segments)
        out = whole.feed(m)
        if out:
            whole_pcm = out[0]
            break
        if not heard_speech and time.monotonic() - started > NO_SPEECH_TIMEOUT_S:
            break
    return {"raw": b"".join(raw), "segments": segments, "whole": whole_pcm}


def run_stt(stt, pcm: bytes) -> dict:
    seconds = len(pcm) / SAMPLE_WIDTH / SEND_SAMPLE_RATE
    t = stt.transcribe(pcm)
    ms = t.ms
    return {
        "text": t.text, "ms": round(ms), "audio_s": round(seconds, 2), "rtf": round(ms / 1000 / seconds, 2) if seconds else None,
        "language": t.language, "language_prob": round(t.language_prob, 2), "rejected_language": t.rejected_language,
        "no_speech": t.no_speech, "retried_without_prompt": t.retried_without_prompt,
    }


def transcribe_take(stt, take: dict, variants_on: bool) -> dict:
    """prod = segments one by one, joined; the other variants run on the same audio with one setting changed."""
    out: dict = {"segments": []}
    for seg in take["segments"]:
        out["segments"].append(run_stt(stt, seg))
    out["prod_text"] = " ".join(s["text"] for s in out["segments"] if s["text"]).strip()
    out["prod_ms"] = sum(s["ms"] for s in out["segments"])
    if variants_on and take["segments"]:
        joined = b"".join(take["segments"])
        out["novocab"] = run_stt(variant(stt, _initial_prompt=None, _hotwords=None), joined)
        out["beam5"] = run_stt(variant(stt, _beam_size=5), joined)
        if take["whole"] is not None:
            out["whole"] = run_stt(stt, take["whole"])
    return out


# ── Session loop ─────────────────────────────────────────────────────────────
def run_item(src, stt, pc: dict, item: dict, n: int, total: int, session: Path, variants_on: bool, channels: int) -> dict | None:
    print(f"\nTest {n:02d}/{total}  [{item['group']}/{item['condition']}]  ({item['id']})")
    print(f"  Say ({item['style']}):")
    print(f'      "{item["say"]}"')
    while True:
        key = input("  Enter = start listening, s = skip, q = quit > ").strip().lower()
        if key in ("", "s", "q"):
            break
    if key == "q":
        return None
    if key == "s":
        return {"skipped": True, "id": item["id"]}
    print("  Speak now...")
    take = capture_take(src, pc)
    if not take["segments"]:
        print("  (no speech detected by the VAD — check the mic level / distance)")
        res = {**item, "n": n, "no_speech": True, "audio": audio_stats(take["raw"], channels) if take["raw"] else {}}
        return res
    base = f"{n:02d}_{re.sub(r'[^A-Za-z0-9@_-]', '', item['id'])}"
    save_wav(session / f"{base}_raw.wav", take["raw"], channels)
    for i, seg in enumerate(take["segments"]):
        save_wav(session / f"{base}_seg{i + 1}.wav", seg)
    if take["whole"]:
        save_wav(session / f"{base}_whole.wav", take["whole"])
    speech_pcm = b"".join(take["segments"])
    stats = audio_stats(speech_pcm)
    stats["raw"] = audio_stats(take["raw"], channels)
    tx = transcribe_take(stt, take, variants_on)
    if channels > 1:
        # Is one physical channel better than the downmix the VAD/STT used? Transcribe each on its own.
        x = np.frombuffer(take["raw"], dtype=np.int16)
        x = x[: len(x) // channels * channels].reshape(-1, channels)
        tx["channels"] = []
        for c in range(channels):
            ch = np.ascontiguousarray(x[:, c]).tobytes()
            save_wav(session / f"{base}_ch{c}.wav", ch)
            tx["channels"].append({"channel": c, "level": audio_stats(ch), **run_stt(stt, ch)})
    sc = score(item["say"], tx["prod_text"])
    res: dict = {
        **item, "n": n, "segments_n": len(take["segments"]), "split": len(take["segments"]) > 1,
        "audio": stats, "stt": tx, "score": sc, "no_speech": False,
    }
    if variants_on:
        for v in ("novocab", "beam5", "whole"):
            if v in tx:
                res[f"score_{v}"] = score(item["say"], tx[v]["text"])
    print(f"  Audio captured: {stats['seconds']:.2f}s in {len(take['segments'])} segment(s)"
          f"{'  <-- SPLIT by VAD' if res['split'] else ''}   level {stats['speech_dbfs']} dBFS, SNR~{stats['snr_db']} dB, peak {stats['peak_dbfs']} dBFS")
    for i, s in enumerate(tx["segments"], 1):
        print(f"  STT segment {i}: {s['ms']}ms (RTF {s['rtf']})  {s['text']!r}"
              f"{'  [language rejected: ' + s['rejected_language'] + ']' if s['rejected_language'] else ''}")
    print(f"  Transcript : {tx['prod_text']!r}")
    print(f"  Expected   : {item['say']!r}")
    mark = "OK" if sc["exact"] else ("NUMBER WRONG" if not sc["numbers_ok"] else "DIFFERS")
    print(f"  Result     : {mark}   WER {sc['wer']:.2f}   numbers {sc['numbers_heard']} (want {sc['numbers_expected']})"
          + (f"   dropped {sc['dropped']}" if sc["dropped"] else "") + (f"   added {sc['added']}" if sc["added"] else ""))
    if variants_on:
        for v in ("novocab", "beam5", "whole"):
            if v in tx:
                s = res[f"score_{v}"]
                print(f"    {v:8s}: WER {s['wer']:.2f}  {tx[v]['text']!r}")
    for c in tx.get("channels", []):
        s = score(item["say"], c["text"])
        res.setdefault("channel_wer", {})[str(c["channel"])] = s["wer"]
        print(f"    channel {c['channel']}: level {c['level'].get('speech_dbfs')} dBFS, WER {s['wer']:.2f}  {c['text']!r}")
    return res


def append(path: Path, rec: dict) -> None:
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def cmd_run(args) -> int:
    pc = production_config()
    cfg = pc["cfg"]
    lights = list((pc["registry"].slots.get("light") or {}).get("values", {}).keys())
    items: list[dict] = []
    if args.set in ("commands", "all"):
        items += build_command_set(lights, not args.no_wake)
    if args.set in ("conditions", "all"):
        items += build_condition_set(not args.no_wake)
    if args.only:
        items = [i for i in items if re.search(args.only, i["id"])]
    session = RESULTS_DIR / datetime.now().strftime("%Y%m%d-%H%M%S")
    session.mkdir(parents=True, exist_ok=True)
    results_path = session / "results.jsonl"

    channels = args.channels
    hint = cfg.get("mic_device_name", "")
    dev = input_device_report(hint)
    meta = {"device": dev, "vad": pc["vad"], "prompt": pc["prompt"], "hotwords": pc["hotwords"],
            "channels_captured": channels, "model": cfg.get("stt_model", "small"), "set": args.set,
            "started": datetime.now().isoformat(timespec="seconds")}
    (session / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"Session: {session}\nMic: {dev['name']}  ({dev['max_input_channels']} ch available, capturing {channels})")
    print("Loading STT (production configuration)...")
    stt = load_stt(pc)
    print(f"STT ready on {stt.device}. Nothing is sent to the CMS, devices or TTS.\n"
          "Speak naturally; commands start with 'Hey Travis' unless --no-wake.")

    src = MicSource(hint, channels)
    n = 0
    with src:
        for item in items:
            n += 1
            res = run_item(src, stt, pc, item, n, len(items), session, not args.no_variants, channels)
            if res is None:
                break
            append(results_path, res)
    print(f"\nWrote {results_path}")
    write_report(session)
    print(f"Report: {session / 'report.md'}")
    return 0


# ── Report ───────────────────────────────────────────────────────────────────
def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else float("nan")


def _corr(xs, ys):
    pairs = [(x, y) for x, y in zip(xs, ys) if x is not None and y is not None]
    if len(pairs) < 5:
        return None
    a, b = np.array(pairs, dtype=float).T
    if a.std() == 0 or b.std() == 0:
        return None
    return round(float(np.corrcoef(a, b)[0, 1]), 2)


def write_report(session: Path) -> None:
    path = session / "results.jsonl"
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()] if path.exists() else []
    rows = [r for r in rows if not r.get("skipped")]
    heard = [r for r in rows if not r.get("no_speech")]
    L: list[str] = [f"# STT diagnostic — {session.name}", ""]
    meta = session / "meta.json"
    if meta.exists():
        m = json.loads(meta.read_text(encoding="utf-8"))
        L += [f"Mic: {m['device']['name']} ({m['device']['max_input_channels']} ch, capturing {m['channels_captured']}); "
              f"model {m['model']}; VAD {m['vad']}", ""]
    L.append(f"Takes: {len(rows)}; no speech detected: {len(rows) - len(heard)}; heard: {len(heard)}\n")
    if not heard:
        (session / "report.md").write_text("\n".join(L), encoding="utf-8")
        return

    def line(label, rs, key="score"):
        rs = [r for r in rs if key in r]
        if not rs:
            return ""  # nothing recorded for this variant
        s = [r[key] for r in rs]
        return (f"| {label} | {len(rs)} | {100 * _mean([x['exact'] for x in s]):.0f}% | {_mean([x['wer'] for x in s]):.2f} "
                f"| {sum(not x['numbers_ok'] for x in s)} |")

    hdr = ["| | takes | exact | mean WER | number errors |", "|---|---|---|---|---|"]
    L += ["## Overall by decode variant (same audio)", ""] + hdr
    for label, key in (("prod (agent as shipped)", "score"), ("no vocabulary prompt", "score_novocab"),
                       ("beam 5", "score_beam5"), ("whole utterance (1.8 s end-silence)", "score_whole")):
        t = line(label, heard, key)
        if t:
            L.append(t)
    L += ["", "## By group (prod)", ""] + hdr
    for g in sorted({r["group"] for r in heard}):
        L.append(line(g, [r for r in heard if r["group"] == g]))
    L += ["", "## By condition (prod)", ""] + hdr
    conds = [c["condition"] for c in ({"condition": r["condition"]} for r in heard)]
    for c in dict.fromkeys(conds):
        sub = [r for r in heard if r["condition"] == c]
        extra = (f" level {_mean([r['audio']['speech_dbfs'] for r in sub]):.0f} dBFS, SNR {_mean([r['audio']['snr_db'] for r in sub]):.0f} dB,"
                 f" split {sum(r['split'] for r in sub)}/{len(sub)}")
        L.append(line(c, sub))
        L.append(f"|  ↳ {c} audio | | | | {extra.strip().rstrip(',')} |")

    # Conditions vs the clean reference (A close, else B normal), per base command
    refs: dict[str, str] = {}
    for r in heard:
        base = r.get("base_id")
        if base and r.get("condition_code") in ("A", "B") and (base not in refs or r["condition_code"] == "A"):
            refs[base] = r["stt"]["prod_text"]
    if refs:
        L += ["", "## Transcript changes vs the clean reference (condition A, else B)", "",
              "| condition | takes | differs from reference | number differs | mean WER vs reference |", "|---|---|---|---|---|"]
        for c in dict.fromkeys(r["condition"] for r in heard if r.get("base_id")):
            sub = [r for r in heard if r["condition"] == c and r.get("base_id") in refs]
            if not sub:
                continue
            sc = [score(refs[r["base_id"]], r["stt"]["prod_text"]) for r in sub]
            L.append(f"| {c} | {len(sub)} | {sum(not s['exact'] for s in sc)} | {sum(not s['numbers_ok'] for s in sc)} "
                     f"| {_mean([s['wer'] for s in sc]):.2f} |")

    # Correlations
    wer = [r["score"]["wer"] for r in heard]
    L += ["", "## Correlation of WER with signal properties (Pearson; needs >=5 takes)", ""]
    for label, key in (("speech level (dBFS)", "speech_dbfs"), ("SNR (dB)", "snr_db"), ("noise floor (dBFS)", "noise_dbfs"),
                       ("peak (dBFS)", "peak_dbfs"), ("clipped %", "clipped_pct")):
        L.append(f"- {label}: {_corr([r['audio'].get(key) for r in heard], wer)}")
    L.append(f"- number of VAD segments: {_corr([r['segments_n'] for r in heard], wer)}")
    L.append(f"- audio length (s): {_corr([r['audio']['seconds'] for r in heard], wer)}")

    # Latency
    ms = [s["ms"] for r in heard for s in r["stt"]["segments"]]
    rtf = [s["rtf"] for r in heard for s in r["stt"]["segments"] if s["rtf"] is not None]
    L += ["", f"## Latency\n\nSTT per segment: mean {_mean(ms):.0f} ms, max {max(ms)} ms; mean RTF {_mean(rtf):.2f}", ""]

    # Hints (suggestions to check, not verdicts)
    L += ["## What the numbers suggest", ""]
    prod_w = _mean([r["score"]["wer"] for r in heard])
    splits = [r for r in heard if r["split"]]
    L.append(f"- VAD segmentation: {len(splits)}/{len(heard)} takes were cut into several utterances"
             + (f"; the same audio as one utterance has WER {_mean([r['score_whole']['wer'] for r in splits if 'score_whole' in r]):.2f} "
                f"vs {_mean([r['score']['wer'] for r in splits]):.2f} cut" if splits and any('score_whole' in r for r in splits) else "") + ".")
    nv, b5 = [r for r in heard if "score_novocab" in r], [r for r in heard if "score_beam5" in r]
    if nv:
        L.append(f"- Vocabulary: WER {prod_w:.2f} with the prompt vs {_mean([r['score_novocab']['wer'] for r in nv]):.2f} without.")
    if b5:
        L.append(f"- Decoding: WER {prod_w:.2f} at beam 1 vs {_mean([r['score_beam5']['wer'] for r in b5]):.2f} at beam 5.")
    wrong_num = [r for r in heard if not r["score"]["numbers_ok"]]
    L.append(f"- Numbers: {len(wrong_num)}/{len(heard)} takes had a wrong or missing number.")
    for r in wrong_num[:12]:
        L.append(f"    - {r['id']} ({r['condition']}): want {r['score']['numbers_expected']} got {r['score']['numbers_heard']} — {r['stt']['prod_text']!r}")
    L.append("- Compare the 'By condition' rows: errors only in far/noise/pause rows point at audio or VAD; errors in 'normal' "
             "rows with good SNR point at the model, vocabulary or decoding.")
    L += ["", "## Every take", "", "| # | id | condition | heard | expected | WER | seg | dBFS | SNR |", "|---|---|---|---|---|---|---|---|---|"]
    for r in heard:
        L.append(f"| {r['n']} | {r['id']} | {r['condition']} | {r['stt']['prod_text']} | {r['say']} | {r['score']['wer']:.2f} "
                 f"| {r['segments_n']} | {r['audio']['speech_dbfs']} | {r['audio']['snr_db']} |")
    (session / "report.md").write_text("\n".join(L) + "\n", encoding="utf-8")


def cmd_report(args) -> int:
    write_report(Path(args.session))
    print(f"Report: {Path(args.session) / 'report.md'}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("inspect").set_defaults(fn=cmd_inspect)
    r = sub.add_parser("run")
    r.add_argument("--set", choices=("commands", "conditions", "all"), default="commands")
    r.add_argument("--only", help="regex on item ids, e.g. 'num|multi'")
    r.add_argument("--no-wake", action="store_true", help="don't prefix 'Hey Travis' (production audio includes it)")
    r.add_argument("--no-variants", action="store_true", help="skip the novocab/beam5/whole comparison decodes")
    r.add_argument("--channels", type=int, default=CHANNELS, help="capture N channels (production = 1; >1 only to test multichannel)")
    r.set_defaults(fn=cmd_run)
    p = sub.add_parser("report")
    p.add_argument("session")
    p.set_defaults(fn=cmd_report)
    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
