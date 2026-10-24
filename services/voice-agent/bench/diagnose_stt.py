"""STT pipeline diagnostic: records a known sentence, then tests each stage (device, raw capture, 16 kHz mono conversion, model, chunking).
Every stage saves a WAV and every transcript gets a word error rate. Stop Travis first: it holds the mic.

    .venv\Scripts\python.exe bench\diagnose_stt.py --list
    .venv\Scripts\python.exe bench\diagnose_stt.py --device <index of the Smiledrive mic> --cuda
    .venv\Scripts\python.exe bench\diagnose_stt.py --file clip.wav

WAVs are written to bench/results/stt_diag/. Uses scipy for WAV files (no soundfile needed).
"""
import argparse
import re
import time
from math import gcd
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel
from scipy.io import wavfile
from scipy.signal import resample_poly

REFERENCE = ("the quick brown fox jumps over the lazy dog. "
             "our meeting starts at nine thirty in the bengaluru office.")
TARGET_SR = 16000
OUT = Path(__file__).resolve().parent / "results" / "stt_diag"


def write_wav(name, audio, sr):
    OUT.mkdir(parents=True, exist_ok=True)
    wavfile.write(OUT / name, sr, (np.clip(np.asarray(audio, dtype=np.float32), -1, 1) * 32767).astype(np.int16))


def read_wav(path):
    sr, data = wavfile.read(path)
    if data.dtype == np.int16:
        data = data.astype(np.float32) / 32768
    elif data.dtype != np.float32:
        data = data.astype(np.float32)
    return (data.reshape(-1, 1) if data.ndim == 1 else data), sr


def wer(ref, hyp):
    norm = lambda s: re.sub(r"[^a-z0-9 ]", " ", s.lower()).split()
    r, h = norm(ref), norm(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev = cur
    return d[len(h)] / max(len(r), 1)


def stats(name, audio, sr):
    a = np.asarray(audio)
    flat = a.astype(np.float64).ravel()
    peak = np.max(np.abs(flat)) if flat.size else 0
    rms = np.sqrt(np.mean(flat ** 2)) if flat.size else 0
    rms_db = 20 * np.log10(rms + 1e-12)
    clip = np.mean(np.abs(flat) >= 0.999) * 100
    print(f"  [{name}] dtype={a.dtype} shape={a.shape} sr={sr} dur={a.shape[0] / sr:.2f}s")
    print(f"           peak={peak:.3f} rms={rms_db:.1f} dBFS clipped={clip:.2f}% dc_offset={flat.mean():+.4f}")
    if a.dtype != np.float32:
        print("           WARNING: not float32 - Whisper wants float32 in [-1, 1]")
    if peak > 1.5:
        print("           WARNING: values > 1 - int16 data not divided by 32768?")
    if rms_db < -45:
        print("           WARNING: very quiet - mic too far, wrong device, or muted")
    if clip > 0.5:
        print("           WARNING: clipping - lower input gain / AGC")
    if abs(flat.mean()) > 0.05:
        print("           WARNING: large DC offset - driver/format problem")


def to_16k_mono(audio, sr):
    if audio.ndim == 2:
        audio = audio.mean(axis=1)
    if sr != TARGET_SR:
        g = gcd(sr, TARGET_SR)
        audio = resample_poly(audio, TARGET_SR // g, sr // g)
    return audio.astype(np.float32)


def transcribe(model, audio, label, results, **kw):
    t = time.time()
    segs, _ = model.transcribe(audio, language="en", beam_size=5, vad_filter=True, condition_on_previous_text=False, **kw)
    text = " ".join(s.text.strip() for s in segs)
    score = wer(REFERENCE, text)
    results.append((label, score))
    print(f"  [{label}] WER={score:.0%}  ({time.time() - t:.1f}s)")
    print(f"           \"{text}\"")
    return text


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--list", action="store_true")
    p.add_argument("--device", type=int)
    p.add_argument("--file")
    p.add_argument("--seconds", type=float, default=10)
    p.add_argument("--countdown", type=int, default=5, help="beeps before recording starts")
    p.add_argument("--chunk", type=float, default=2.0)
    p.add_argument("--model", default="small")
    p.add_argument("--compare-model")
    p.add_argument("--cuda", action="store_true")
    a = p.parse_args()

    import sounddevice as sd
    if a.list:
        print(sd.query_devices())
        return

    results = []
    if a.file:
        print(f"\n== Stage 1-2: loading {a.file}")
        raw, native_sr = read_wav(a.file)
    else:
        info = sd.query_devices(a.device, "input")
        native_sr = int(info["default_samplerate"])
        ch = min(2, int(info["max_input_channels"]))
        print(f"\n== Stage 1: device '{info['name']}' native_sr={native_sr} channels={info['max_input_channels']}")
        print(f"\n== Stage 2: recording {a.seconds:.0f}s at native rate. Read this at normal volume from where you usually sit:\n")
        print(f"   >>> {REFERENCE}\n")
        import winsound
        for n in range(a.countdown, 0, -1):
            print(f"   starting in {n}...", flush=True)
            winsound.Beep(600, 150)
            time.sleep(0.85)
        print("   RECORDING NOW - speak!", flush=True)
        raw = sd.rec(int(a.seconds * native_sr), samplerate=native_sr, channels=ch, dtype="float32", device=a.device)
        winsound.Beep(1200, 400)
        sd.wait()
        winsound.Beep(800, 400)
        print("   done.")
    write_wav("1_raw_native.wav", raw, native_sr)
    stats("raw", raw, native_sr)
    if raw.shape[1] > 1:
        for c in range(raw.shape[1]):
            r = 20 * np.log10(np.sqrt(np.mean(raw[:, c] ** 2)) + 1e-12)
            print(f"           channel {c}: rms={r:.1f} dBFS")

    print("\n== Stage 3: convert to 16 kHz mono float32")
    conv = to_16k_mono(raw, native_sr)
    write_wav("2_converted_16k.wav", conv, TARGET_SR)
    stats("converted", conv, TARGET_SR)

    print(f"\n== Stage 4: transcribe whole clip with '{a.model}'")
    dev, ct = ("cuda", "float16") if a.cuda else ("cpu", "int8")
    model = WhisperModel(a.model, device=dev, compute_type=ct)
    transcribe(model, conv, f"{a.model}, whole clip", results)
    if native_sr != TARGET_SR:
        transcribe(model, raw.mean(axis=1).astype(np.float32), f"{a.model}, BUG SIM: {native_sr}Hz fed as 16k", results)
    if a.compare_model:
        transcribe(WhisperModel(a.compare_model, device=dev, compute_type=ct), conv, f"{a.compare_model}, whole clip", results)

    print(f"\n== Stage 5: {a.chunk:.1f}s chunks transcribed independently")
    n = int(a.chunk * TARGET_SR)
    parts = []
    for i in range(0, len(conv), n):
        seg, _ = model.transcribe(conv[i:i + n], language="en", beam_size=5, condition_on_previous_text=False)
        parts.append(" ".join(s.text.strip() for s in seg))
    joined = " ".join(parts)
    score = wer(REFERENCE, joined)
    results.append((f"{a.model}, {a.chunk:.1f}s chunks", score))
    print(f"  WER={score:.0%}\n  \"{joined}\"")

    print("\n== Summary (lower WER is better)")
    for label, score in results:
        print(f"  {score:6.0%}  {label}")
    print(f"\nListen to {OUT}\1_raw_native.wav and 2_converted_16k.wav as well.")


if __name__ == "__main__":
    main()
