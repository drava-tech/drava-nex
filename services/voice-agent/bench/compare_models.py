"""Near-mic vs far-mic, small vs turbo vs large-v3, on real spoken commands with Travis's own STT setup.

    python -m bench.compare_models record --mic near     laptop mic (near), 20 commands, beeps before each
    python -m bench.compare_models record --mic far      Smiledrive conference mic (far)
    python -m bench.compare_models score [session ...]   replay every recording through each model

Record once, score many: both mics read the same list and each model decodes the exact same audio, so a
difference is the model or the mic, not the take. Scoring uses the production WhisperSTT (command prompt,
stt_hotwords, fallback-prompt retry) on the production WebRTC VAD segments, then applies the stt_min_logprob
gate. STOP THE AGENT FIRST (it holds the mic and the GPU). Output: bench/results/compare_models/<session>/.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import wave
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bench import stt_diag as sd  # noqa: E402
from settings import SEND_SAMPLE_RATE  # noqa: E402

OUT = ROOT / "bench" / "results" / "compare_models"
MIC_HINTS = {"near": "Microphone Array (Intel", "far": "Headset (Smiledrive)"}

# Spoken after "Hey Travis". Real names from the room (see CLAUDE.md "Room names"); names, numbers, short ones.
COMMANDS = [
    "turn on the cove light",
    "turn off the cove light",
    "turn on the sky light",
    "turn off the sky light",
    "set the sky light front to 50 percent",
    "set the sky light back to 30 percent",
    "set the cove light to 80 percent",
    "dim the sky light to 20 percent",
    "turn on all the lights",
    "turn on the AC",
    "turn off the AC",
    "set the AC to 24 degrees",
    "set the AC to 18 degrees",
    "turn on tusker 86",
    "turn off tusker 27",
    "stop",
    "reset view",
    "hi",
    "lock the door",
    "volume up",
]

# model label -> (stt_model, compute_type). turbo = the local CT2 copy; large-v3 = HF cache (Systran).
MODELS = {
    "small": ("small", None),
    "large-v3": ("large-v3", "int8_float16"),
}


OUT_DEVICE = "Speakers (Realtek"  # where the cue tones play; --out overrides
_OUT_STREAM = None


def _output_index(hint: str) -> int | None:
    import sounddevice as sd

    for i, d in enumerate(sd.query_devices()):
        if d["max_output_channels"] > 0 and hint.lower() in d["name"].lower() and sd.query_hostapis(d["hostapi"])["name"] == "MME" or (
            d["max_output_channels"] > 0 and hint.lower() in d["name"].lower() and sd.query_hostapis(d["hostapi"])["name"] == "MME"
        ):
            return i
    return None


def say(text: str) -> None:
    """Speak a cue with Windows' built-in offline voice (no network, not ElevenLabs), so the person knows what to do."""
    import subprocess

    subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         f"Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = 0; $s.Speak('{text}')"],
        check=False,
    )


def beep(freq: int, ms: int) -> None:
    """A real tone through the chosen output (winsound.Beep can be silent on Windows 11)."""
    import numpy as np
    import sounddevice as sd

    global _OUT_STREAM
    sr = 44100
    if _OUT_STREAM is None:
        # One stream kept open for the whole run: a speaker that sleeps between short tones swallows the first ones.
        _OUT_STREAM = sd.OutputStream(device=_output_index(OUT_DEVICE), samplerate=sr, channels=1, dtype="float32")
        _OUT_STREAM.start()
        _OUT_STREAM.write(np.zeros(sr, dtype=np.float32))  # 1 s of silence wakes the output
    t = np.arange(int(sr * ms / 1000)) / sr
    tone = (0.7 * np.sin(2 * np.pi * freq * t) * np.minimum(1, np.minimum(t, t[::-1] + 1e-9) * 200)).astype(np.float32)
    _OUT_STREAM.write(tone)
    _OUT_STREAM.write(np.zeros(int(sr * 0.1), dtype=np.float32))


def write_wav(path: Path, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SEND_SAMPLE_RATE)
        w.writeframes(pcm)


def cmd_record(args) -> int:
    pc = sd.production_config()
    session = OUT / f"{datetime.now():%Y%m%d-%H%M%S}-{args.mic}"
    session.mkdir(parents=True)
    commands = COMMANDS[: args.limit] if args.limit else COMMANDS
    print(f"Mic: {args.mic} ({MIC_HINTS[args.mic]}) -> {session}")
    print("For each command: 3 short beeps, then a HIGH beep = speak. Say 'Hey Travis, <command>' in your normal voice.")
    print("A low beep means that take is finished.\n")
    manifest = []
    with sd.MicSource(MIC_HINTS[args.mic], 1) as src:
        time.sleep(1.5)
        for i, text in enumerate(commands, 1):
            print(f"[{i}/{len(commands)}] Hey Travis, {text}", flush=True)
            for _ in range(3):
                beep(600, 120)
                time.sleep(0.5)
            print("      >>>>>>  SPEAK NOW  <<<<<<", flush=True)
            beep(1200, 350)
            take = sd.capture_take(src, pc)
            beep(800, 250)
            segs = []
            for j, pcm in enumerate(take["segments"]):
                f = f"{i:02d}_seg{j}.wav"
                write_wav(session / f, pcm)
                segs.append(f)
            write_wav(session / f"{i:02d}_raw.wav", take["raw"])
            manifest.append({"n": i, "expected": f"hey travis {text}", "segments": segs})
            print(f"      captured {len(segs)} segment(s)", flush=True)
            time.sleep(1.0)
    (session / "manifest.json").write_text(json.dumps({"mic": args.mic, "items": manifest}, indent=1))
    print(f"\nDone. Score with: python -m bench.compare_models score {session.name}")
    return 0


def cmd_record_all(args) -> int:
    """One continuous read of the whole list; split at the pauses with the production VAD, matched to the list in order."""
    from math import gcd

    import numpy as np
    import sounddevice as sdev
    from scipy.signal import resample_poly

    pc = sd.production_config()
    hint = args.device or MIC_HINTS[args.mic]
    idx = args.index if args.index is not None else next(
        (i for i, d in enumerate(sdev.query_devices()) if d["max_input_channels"] > 0 and hint.lower() in d["name"].lower()), None)
    if idx is None:
        print(f"No input device matching {hint!r}")
        return 1
    d = sdev.query_devices(idx)
    sr, ch = int(d["default_samplerate"]), min(int(d["max_input_channels"]), 2)
    label = args.label or args.mic
    session = OUT / f"{datetime.now():%Y%m%d-%H%M%S}-{label}"
    session.mkdir(parents=True)
    print(f"Mic: {label} -> #{idx} {d['name']} ({sr} Hz, {ch} ch) -> {session}\n")
    for i, text in enumerate(COMMANDS, 1):
        print(f"  {i:2d}. Hey Travis, {text}")
    if args.slot:
        print(f"\n3 low tones, then a tick every {args.slot:.0f} s: say the next command at each tick. A lower tone at the end = done.\n", flush=True)
    else:
        print(f"\nRead them in this order, ONE after another, with a ~2 s pause between commands. Max {args.seconds:.0f} s.")
        print("3 low tones, then a HIGH tone = start. A LOW tone = stop.\n", flush=True)
    chunks: list = []
    stream = sdev.InputStream(device=idx, channels=ch, samplerate=sr, dtype="float32", callback=lambda x, f, t, s: chunks.append(x.copy()))
    if args.slot:
        say(f"Get ready. I will make a short tick sound every {args.slot:.0f} seconds. At each tick, say the next command from the list, starting with Hey Travis. The first tick comes in three seconds.")
        time.sleep(2.0)
    else:
        for _ in range(3):
            beep(600, 120)
            time.sleep(0.5)
    stream.start()
    t0 = time.monotonic()
    starts = []
    if args.slot:
        # A tick marks the start of every command's slot; the recording is cut by these times, not by pauses.
        print(">>>>>>  tick = next command; first tick now  <<<<<<", flush=True)
        for i in range(len(COMMANDS)):
            wait = t0 + i * args.slot - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            starts.append(time.monotonic() - t0)
            print(f"  {i + 1:2d}/{len(COMMANDS)}  Hey Travis, {COMMANDS[i]}", flush=True)
            beep(1200, 150)
        time.sleep(max(0.0, t0 + len(COMMANDS) * args.slot - time.monotonic()))
    else:
        print(">>>>>>  START READING NOW  <<<<<<", flush=True)
        beep(1200, 350)
        time.sleep(args.seconds)
    stream.stop()
    stream.close()
    wall = time.monotonic() - t0
    say("Stop. Recording finished.")
    x = np.concatenate(chunks)
    mono_f = x.mean(axis=1) if x.ndim > 1 else x
    g = gcd(sr, SEND_SAMPLE_RATE)
    pcm16 = (np.clip(resample_poly(mono_f, SEND_SAMPLE_RATE // g, sr // g), -1, 1) * 32767).astype(np.int16)
    write_wav(session / "all_raw.wav", pcm16.tobytes())
    segs = []
    if args.slot:
        # A Bluetooth mic starts delivering audio late (the file is shorter than the time that passed), so every
        # slot's speech sits earlier in the file by that gap. Measured, not assumed: lag = wall time - audio length.
        lag = max(0.0, wall - len(pcm16) / SEND_SAMPLE_RATE)
        print(f"Audio is {lag:.2f} s shorter than the time that passed; slots shifted by that.")
        # Slot i = [tick_i + 0.3 s (skips the tick's own sound), tick_{i+1} + 0.3 s) minus the lag; one utterance.
        for i, st in enumerate(starts):
            end = starts[i + 1] if i + 1 < len(starts) else st + args.slot
            a, b = max(0, int((st - lag + 0.3) * SEND_SAMPLE_RATE)), min(len(pcm16), int((end - lag + 0.3) * SEND_SAMPLE_RATE))
            ep = sd.make_endpointer(pc["vad"], end_ms=args.split_ms, max_ms=20000)
            found = []
            sl = np.concatenate([pcm16[a:b], np.zeros(SEND_SAMPLE_RATE, dtype=np.int16)])  # trailing silence ends the cut
            for off in range(0, len(sl), 512):
                found += ep.feed(sl[off:off + 512].tobytes())
            seg = b"".join(found)
            if not seg:
                # The slot already isolates one command; if there is clear sound but the VAD saw no end of speech
                # (a noisy room never gives it a full second of quiet), use the slot's own audio instead of nothing.
                fr = pcm16[a:b][: (b - a) // 320 * 320].astype(np.float32).reshape(-1, 320) / 32768
                loud = int((20 * np.log10(np.sqrt((fr ** 2).mean(axis=1)) + 1e-9) > -40).sum())
                if loud >= 25:  # 0.5 s of sound
                    seg = pcm16[a:b].tobytes()
                    print(f"  slot {i + 1}: VAD found no end of speech, used the slot window ({loud * 20} ms of sound)")
            segs.append(seg)
    else:
        ep = sd.make_endpointer(pc["vad"], end_ms=args.split_ms, max_ms=20000)
        step = 512
        for off in range(0, len(pcm16), step):
            segs += ep.feed(pcm16[off:off + step].tobytes())
    empty = [n for n, s in enumerate(segs, 1) if len(s) < int(0.3 * SEND_SAMPLE_RATE) * 2]
    print(f"\nSpeech found in {len(segs) - len(empty)} of {len(COMMANDS)} slots; peak overall {np.abs(pcm16).max() / 32768:.3f}")
    if empty:
        print(f"NO speech in slot(s): {empty}. If that is most of them the recording is not valid - do not score it.")
    items = []
    for n, s in enumerate(segs, 1):
        f = f"{n:02d}_seg0.wav"
        write_wav(session / f, s)
        items.append({"n": n, "expected": f"hey travis {COMMANDS[n - 1]}" if n <= len(COMMANDS) else "?", "segments": [f]})
    (session / "manifest.json").write_text(json.dumps({"mic": label, "aligned": len(segs) == len(COMMANDS) and not empty, "items": items}, indent=1))
    if len(segs) != len(COMMANDS) or len(empty) > 2:
        print("Not a valid recording - redo it.")
    else:
        print(f"Valid. Score with: python -m bench.compare_models score {session.name}")
    return 0


def _read_wav(path: Path) -> bytes:
    with wave.open(str(path), "rb") as w:
        return w.readframes(w.getnframes())


def _load(pc: dict, label: str):
    from speech.stt import WhisperSTT
    from agent.vocabulary import stt_names_prompt

    cfg = pc["cfg"]
    model, ct = MODELS[label]
    if model.startswith("../"):
        model = str((ROOT / model).resolve())
    return WhisperSTT(
        model=model, device=cfg.get("stt_device", "cuda"),
        compute_type=ct or cfg.get("stt_compute_type", "float16"),
        hotwords=pc["hotwords"], initial_prompt=pc["prompt"], cuda_lib_dir=cfg.get("stt_cuda_lib_dir") or None,
        reject_threshold=float(cfg.get("stt_reject_language_threshold", 0.5)),
        english_floor=float(cfg.get("stt_english_floor", 0.15)),
        single_pass=bool(cfg.get("stt_single_pass", True)),
        fallback_prompt=stt_names_prompt(pc["registry"], cfg),
        retry_below=cfg.get("stt_retry_below", -0.30),
    )


def cmd_score(args) -> int:
    sessions = [OUT / s for s in args.sessions] or sorted(OUT.glob("*-*"))[-2:]
    pc = sd.production_config()
    gate = pc["cfg"].get("stt_min_logprob", -0.5)
    results: dict[str, dict[str, list[dict]]] = {}
    for label in args.models:
        print(f"== loading {label} ...", flush=True)
        try:
            stt = _load(pc, label)
        except Exception as e:
            print(f"   skipped {label}: {e}")
            continue
        print(f"   on {stt.device}")
        for s in sessions:
            m = json.loads((s / "manifest.json").read_text())
            rows = []
            for it in m["items"]:
                texts, ms, lp = [], 0.0, []
                for f in it["segments"]:
                    t = stt.transcribe(_read_wav(s / f))
                    texts.append(t.text)
                    ms += t.ms
                    if t.avg_logprob is not None and t.text:
                        lp.append(t.avg_logprob)
                heard = " ".join(x for x in texts if x).strip()
                sc = sd.score(it["expected"], heard)
                gated = bool(lp) and gate and min(lp) < gate
                rows.append({"n": it["n"], "expected": it["expected"], "heard": heard, "ms": ms,
                             "gated": gated, "logprob": min(lp) if lp else None, **sc})
            results.setdefault(m["mic"], {})[label] = rows
        del stt
    lines = ["# near vs far, model comparison\n",
             f"Sessions: {', '.join(s.name for s in sessions)}; gate stt_min_logprob={gate}\n",
             "| mic | model | runs correctly | numbers ok | exact text | mean WER | gated (asks to repeat) | median ms |",
             "|---|---|---|---|---|---|---|---|"]
    for mic, by_model in results.items():
        for label, rows in by_model.items():
            n = len(rows)
            good = sum(1 for r in rows if r["exact"] and not r["gated"])
            nums = [r for r in rows if r["numbers_expected"]]
            lines.append(
                f"| {mic} | {label} | {good}/{n} | {sum(r['numbers_ok'] for r in nums)}/{len(nums)} | "
                f"{sum(r['exact'] for r in rows)}/{n} | {statistics.mean(r['wer'] for r in rows):.0%} | "
                f"{sum(r['gated'] for r in rows)}/{n} | {statistics.median(r['ms'] for r in rows):.0f} |")
    lines.append("\n## Every command\n")
    for mic, by_model in results.items():
        for label, rows in by_model.items():
            lines.append(f"### {mic} / {label}\n")
            for r in rows:
                flag = "ok " if r["exact"] and not r["gated"] else ("GATE" if r["gated"] else "MISS")
                lines.append(f"- {flag} {r['expected']!r} -> {r['heard']!r}  (logprob {r['logprob']})")
            lines.append("")
    report = OUT / f"report-{datetime.now():%Y%m%d-%H%M%S}.md"
    report.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:4 + 2 + len(results) * len(args.models)]))
    print(f"\nFull report: {report}")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("record")
    r.add_argument("--mic", choices=("near", "far"), required=True)
    r.add_argument("--limit", type=int, help="only the first N commands")
    r.add_argument("--device", help="input device name hint (default: per --mic)")
    r.add_argument("--out", help="output device name hint for the cue tones")
    ra = sub.add_parser("record-all", help="read the whole list in one go; split at the pauses")
    ra.add_argument("--mic", choices=("near", "far"), required=True)
    ra.add_argument("--device", help="input device name substring (default: per --mic)")
    ra.add_argument("--index", type=int, help="exact input device number (from the device list); wins over --device")
    ra.add_argument("--label", help="session suffix, e.g. bluetooth / usb (default: the --mic value)")
    ra.add_argument("--seconds", type=float, default=110)
    ra.add_argument("--slot", type=float, help="seconds per command; a tick marks each slot (cuts by time, not pauses)")
    ra.add_argument("--split-ms", type=int, default=1000, help="silence that ends one command")
    ra.add_argument("--out", help="output device name hint for the cue tones")
    b = sub.add_parser("beeptest")
    b.add_argument("--out", help="output device name hint for the cue tones")
    s = sub.add_parser("score")
    s.add_argument("sessions", nargs="*")
    s.add_argument("--models", nargs="+", default=list(MODELS), choices=list(MODELS))
    a = p.parse_args(argv)
    global OUT_DEVICE
    OUT_DEVICE = getattr(a, "out", None) or OUT_DEVICE
    if a.cmd == "beeptest":
        for f in (600, 600, 600, 1200, 800):
            print("beep", f, flush=True)
            beep(f, 300)
            time.sleep(0.4)
        return 0
    if a.cmd == "record" and a.device:
        MIC_HINTS[a.mic] = a.device
    if a.cmd == "record-all":
        return cmd_record_all(a)
    return cmd_record(a) if a.cmd == "record" else cmd_score(a)


if __name__ == "__main__":
    raise SystemExit(main())
