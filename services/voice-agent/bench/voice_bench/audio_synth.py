"""Synthetic speech for the audio benchmark: Windows SAPI voices + numpy augmentation.

SAPI gives two clean US-English voices (David, Zira). That is enough to test
the pipeline's mechanics (VAD, wake word, Whisper, number handling, background
speech, noise, distance) but it is NOT a stand-in for real people: no Indian
English, no real accents, no real rooms, no real overlapping talkers. Those
need recorded clips (see record_clips.py); every report says which results
come from synthetic speech.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

SR = 16000
CACHE = Path(__file__).resolve().parents[1] / ".cache" / "audio"
VOICES = {"david": "Microsoft David Desktop", "zira": "Microsoft Zira Desktop"}

_PS = r"""
param([string]$Manifest)
Add-Type -AssemblyName System.Speech
$items = Get-Content -Raw -Encoding UTF8 -Path $Manifest | ConvertFrom-Json
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($it in $items) {
  $s.SelectVoice($it.voice)
  $s.Rate = [int]$it.rate
  $s.Volume = [int]$it.volume
  $s.SetOutputToWaveFile($it.path, $fmt)
  $s.Speak($it.text)
  $s.SetOutputToNull()
}
"""


def _path(text: str, voice: str, rate: int, volume: int) -> Path:
    h = hashlib.sha1(f"{text}|{voice}|{rate}|{volume}".encode()).hexdigest()[:20]
    return CACHE / f"{h}.wav"


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path)) as w:
        assert w.getframerate() == SR and w.getnchannels() == 1, f"unexpected format in {path}"
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0


def write_wav(path: Path, audio: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(to_int16(audio).tobytes())


def to_int16(x: np.ndarray) -> np.ndarray:
    return (np.clip(x, -1.0, 1.0) * 32767).astype(np.int16)


def synth(items: list[dict]) -> list[np.ndarray]:
    """items: {text, voice ('david'|'zira'), rate (-10..10, default 0), volume (default 100)} -> float32 audio, in order."""
    CACHE.mkdir(parents=True, exist_ok=True)
    todo, paths = [], []
    for it in items:
        voice = VOICES[it.get("voice", "david")]
        p = _path(it["text"], voice, int(it.get("rate", 0)), int(it.get("volume", 100)))
        paths.append(p)
        if not p.exists() and not any(t["path"] == str(p) for t in todo):
            todo.append({"text": it["text"], "voice": voice, "rate": int(it.get("rate", 0)), "volume": int(it.get("volume", 100)), "path": str(p)})
    if todo:
        with tempfile.TemporaryDirectory() as tmp:
            manifest, script = Path(tmp) / "m.json", Path(tmp) / "s.ps1"
            manifest.write_text(json.dumps(todo), encoding="utf-8")
            script.write_text(_PS, encoding="utf-8")
            for start in range(0, len(todo), 400):  # keep each PowerShell run bounded
                chunk = todo[start : start + 400]
                manifest.write_text(json.dumps(chunk), encoding="utf-8")
                subprocess.run(
                    ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script), str(manifest)],
                    check=True, capture_output=True, timeout=1800,
                )
    return [normalize_level(read_wav(p)) for p in paths]


# ─── level, noise, distance, mixing ────────────────────────────────────────


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x * x))) if x.size else 0.0


def speech_rms(x: np.ndarray, frame: int = 480, floor_db: float = -45.0) -> float:
    """RMS over the frames that are actually speech (so leading/trailing silence doesn't count)."""
    n = len(x) // frame
    if n == 0:
        return rms(x)
    frames = x[: n * frame].reshape(n, frame)
    levels = np.sqrt((frames**2).mean(axis=1))
    live = levels[levels > 10 ** (floor_db / 20)]
    return float(np.sqrt((live**2).mean())) if live.size else rms(x)


def normalize_level(x: np.ndarray, target_db: float = -22.0) -> np.ndarray:
    r = speech_rms(x)
    return x if r == 0 else np.clip(x * (10 ** (target_db / 20) / r), -1, 1).astype(np.float32)


def pad(x: np.ndarray, lead_s: float = 0.0, tail_s: float = 0.0) -> np.ndarray:
    return np.concatenate([np.zeros(int(lead_s * SR), np.float32), x, np.zeros(int(tail_s * SR), np.float32)])


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SR), np.float32)


def noise(kind: str, n: int, rng: np.random.Generator) -> np.ndarray:
    white = rng.standard_normal(n).astype(np.float32)
    if kind == "white":
        out = white
    elif kind == "pink":
        f = np.fft.rfft(white)
        f /= np.sqrt(np.maximum(np.arange(len(f)), 1))
        out = np.fft.irfft(f, n).astype(np.float32)
    elif kind == "hum":  # mains hum + a little fan noise
        t = np.arange(n) / SR
        out = (np.sin(2 * np.pi * 50 * t) + 0.5 * np.sin(2 * np.pi * 100 * t) + 0.3 * white).astype(np.float32)
    else:
        raise ValueError(kind)
    return out / (rms(out) or 1.0)


def add_noise(x: np.ndarray, snr_db: float, kind: str, rng: np.random.Generator) -> np.ndarray:
    n = noise(kind, len(x), rng) * speech_rms(x) / (10 ** (snr_db / 20))
    return (x + n).astype(np.float32)


def at_distance(x: np.ndarray, meters: float, rng: np.random.Generator, ref_m: float = 0.5) -> np.ndarray:
    """A crude far-field mic: 1/d level loss, a growing reverberant tail, high-frequency loss and a fixed mic noise floor."""
    gain = ref_m / max(meters, ref_m)
    rt60 = 0.35 + 0.08 * meters
    ir_n = int(rt60 * SR)
    ir = (rng.standard_normal(ir_n) * np.exp(-6.9 * np.arange(ir_n) / ir_n)).astype(np.float32)
    ir /= np.abs(ir).sum() or 1.0
    wet = min(0.85, 0.12 * meters)
    reverb = np.convolve(x, ir)[: len(x)] * 3.0
    y = (1 - wet) * x + wet * reverb
    k = max(1, int(1 + meters))  # moving-average low-pass: more loss when farther
    y = np.convolve(y, np.ones(k, np.float32) / k, mode="same")
    y = y * gain + (rng.standard_normal(len(y)) * 10 ** (-58 / 20)).astype(np.float32)  # mic floor ~ -58 dBFS
    return y.astype(np.float32)


def mix(speech: np.ndarray, other: np.ndarray, sir_db: float, offset_s: float = 0.0) -> np.ndarray:
    """Add `other` under `speech` so the speech-to-interferer ratio is sir_db (looped/trimmed to fit)."""
    n = len(speech)
    off = int(offset_s * SR)
    bed = np.zeros(n, np.float32)
    seg = other[: max(0, n - off)]
    bed[off : off + len(seg)] = seg
    target = speech_rms(speech) / (10 ** (sir_db / 20))
    r = speech_rms(bed) or 1.0
    return (speech + bed * (target / r)).astype(np.float32)


def concat(parts: list[np.ndarray], gap_s: float | list[float] = 0.4) -> np.ndarray:
    out: list[np.ndarray] = []
    for i, p in enumerate(parts):
        out.append(p)
        if i < len(parts) - 1:
            out.append(silence(gap_s[i] if isinstance(gap_s, list) else gap_s))
    return np.concatenate(out) if out else np.zeros(0, np.float32)
