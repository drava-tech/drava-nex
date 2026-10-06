from __future__ import annotations

import json
import math
import os
import platform
import random
import subprocess
import sys
import threading
import time
from pathlib import Path

import psutil

# pyrefly: ignore [missing-import]
from PyQt6.QtCore import (
    QPointF,
    QRectF,
    Qt,
    QTimer,
    pyqtSignal,
)

# pyrefly: ignore [missing-import]
from PyQt6.QtGui import (
    QBrush,
    QColor,
    QFont,
    QImage,
    QKeySequence,
    QPainter,
    QPen,
    QPixmap,
    QPolygonF,
    QShortcut,
)

# pyrefly: ignore [missing-import]
from PyQt6.QtWidgets import (
    QApplication,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QPushButton,
    QSizePolicy,
    QStackedWidget,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)


def _base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent


BASE_DIR = _base_dir()
CONFIG_DIR = BASE_DIR / "config"
API_FILE = CONFIG_DIR / "api_keys.json"

_DEFAULT_W, _DEFAULT_H = 980, 700
_MIN_W, _MIN_H = 820, 580
_LEFT_W = 148
_RIGHT_W = 340

_OS = platform.system()  # "Windows" | "Darwin" | "Linux"


class C:
    BG = "#000000"
    PANEL = "#09090b"
    PANEL2 = "#111111"
    BORDER = "#27272a"
    BORDER_B = "#fbb54a"
    BORDER_A = "#3f3f46"
    PRI = "#fbb54a"
    PRI_DIM = "#9a6f2a"
    PRI_GHO = "#241a08"
    ACC = "#00f0ff"
    ACC2 = "#c2e62a"
    GREEN = "#10B981"
    GREEN_D = "#087a55"
    RED = "#ff3355"
    MUTED_C = "#ff3366"
    TEXT = "#ffffff"
    TEXT_DIM = "#71717a"
    TEXT_MED = "#a1a1aa"
    WHITE = "#f4f4f5"
    DARK = "#050505"
    BAR_BG = "#18181b"


def qcol(h: str, a: int = 255) -> QColor:
    c = QColor(h)
    c.setAlpha(a)
    return c


# Rubik sticker colour-code -> on-screen QColor (mirrors the OpenCV _BGR map in
# actions/cube_coach.py, but as hex for Qt). Used by VisualPanel's "cube" cards.
_STICKER_HEX = {
    "y": "#ffe53c",
    "w": "#f5f5f5",
    "r": "#e23232",
    "g": "#3caf46",
    "o": "#ff8a1e",
    "b": "#2c6edc",
}

# Net layout: (row, col) in cells of each face's top-left, drawn as the standard
# unfolded cross (U on top; L F R B across the middle; D on the bottom). Matches
# _NET_POS in actions/cube_coach.py.
_NET_POS = {
    "U": (0, 3),
    "L": (3, 0),
    "F": (3, 3),
    "R": (3, 6),
    "B": (3, 9),
    "D": (6, 3),
}


class _SysMetrics:
    def __init__(self):
        self.cpu = 0.0
        self.mem = 0.0
        self.net = 0.0
        self.gpu = -1.0
        self.tmp = -1.0
        self._lock = threading.Lock()
        self._last_net = psutil.net_io_counters()
        self._last_net_t = time.time()
        self._running = True
        # GPU/temp readings come from spawning external processes (nvidia-smi,
        # powermetrics, powershell/WMI), which are far too costly to run on every
        # tick. Probe them on a slower cadence, and once a probe proves
        # unavailable a few times stop spawning the process altogether — a
        # machine without an NVIDIA GPU or a thermal sensor won't grow one.
        self._tick = 0
        self._gpu_ok = True
        self._tmp_ok = True
        self._gpu_miss = 0
        self._tmp_miss = 0
        t = threading.Thread(target=self._loop, daemon=True)
        t.start()

    # How many 1.5s ticks between expensive (subprocess) GPU/temp probes, and
    # how many consecutive "unavailable" reads before a probe is disabled.
    _SLOW_EVERY = 4
    _MISS_LIMIT = 3

    def _loop(self):
        while self._running:
            try:
                self._update()
            except Exception:
                pass
            time.sleep(1.5)

    def _update(self):
        cpu = psutil.cpu_percent(interval=None)
        mem = psutil.virtual_memory().percent

        nc = psutil.net_io_counters()
        now = time.time()
        dt = now - self._last_net_t
        if dt > 0:
            sent = (nc.bytes_sent - self._last_net.bytes_sent) / dt
            recv = (nc.bytes_recv - self._last_net.bytes_recv) / dt
            net = (sent + recv) / (1024 * 1024)
        else:
            net = 0.0
        self._last_net = nc
        self._last_net_t = now

        self._tick += 1
        with self._lock:
            self.cpu = cpu
            self.mem = mem
            self.net = net

        # Only the cheap metrics above refresh every tick; the costly probes run
        # occasionally and self-disable when they keep coming back empty.
        if self._tick % self._SLOW_EVERY != 0:
            return

        if self._gpu_ok:
            gpu = self._get_gpu()
            self._gpu_miss = self._gpu_miss + 1 if gpu < 0 else 0
            if self._gpu_miss >= self._MISS_LIMIT:
                self._gpu_ok = False
            with self._lock:
                self.gpu = gpu

        if self._tmp_ok:
            tmp = self._get_temp()
            self._tmp_miss = self._tmp_miss + 1 if tmp < 0 else 0
            if self._tmp_miss >= self._MISS_LIMIT:
                self._tmp_ok = False
            with self._lock:
                self.tmp = tmp

    def _get_gpu(self) -> float:
        # NVIDIA
        try:
            r = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-gpu=utilization.gpu",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                text=True,
                timeout=2,
            )
            if r.returncode == 0:
                vals = [
                    float(v.strip()) for v in r.stdout.strip().split("\n") if v.strip()
                ]
                if vals:
                    return sum(vals) / len(vals)
        except Exception:
            pass

        # AMD (Linux)
        if _OS == "Linux":
            try:
                r = subprocess.run(
                    ["rocm-smi", "--showuse", "--csv"],
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                if r.returncode == 0:
                    for line in r.stdout.strip().split("\n"):
                        parts = line.split(",")
                        if len(parts) >= 2:
                            try:
                                return float(parts[1].strip().replace("%", ""))
                            except ValueError:
                                pass
            except Exception:
                pass

            # Intel GPU (Linux)
            try:
                r = subprocess.run(
                    ["intel_gpu_top", "-J", "-s", "500"],
                    capture_output=True,
                    text=True,
                    timeout=1,
                )
                if r.returncode == 0 and "Render/3D" in r.stdout:
                    import re

                    m = re.search(r'"busy":\s*([\d.]+)', r.stdout)
                    if m:
                        return float(m.group(1))
            except Exception:
                pass

        # macOS — powermetrics (GPU Engine)
        if _OS == "Darwin":
            try:
                r = subprocess.run(
                    [
                        "sudo",
                        "-n",
                        "powermetrics",
                        "-n",
                        "1",
                        "-i",
                        "500",
                        "--samplers",
                        "gpu_power",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=2,
                )
                if r.returncode == 0 and "GPU" in r.stdout:
                    import re

                    m = re.search(r"GPU\s+Active:\s+([\d.]+)%", r.stdout)
                    if m:
                        return float(m.group(1))
            except Exception:
                pass

        return -1.0

    def _get_temp(self) -> float:
        try:
            temps = psutil.sensors_temperatures()
            candidates = [
                "coretemp",
                "k10temp",
                "cpu_thermal",
                "acpitz",
                "cpu-thermal",
                "zenpower",
                "it8688",
            ]
            for name in candidates:
                if name in temps:
                    entries = temps[name]
                    if entries:
                        return entries[0].current
            for entries in temps.values():
                if entries:
                    return entries[0].current
        except Exception:
            pass
        if _OS == "Darwin":
            try:
                r = subprocess.run(
                    ["osx-cpu-temp"], capture_output=True, text=True, timeout=2
                )
                if r.returncode == 0:
                    import re

                    m = re.search(r"([\d.]+)", r.stdout)
                    if m:
                        return float(m.group(1))
            except Exception:
                pass

        if _OS == "Windows":
            try:
                r = subprocess.run(
                    [
                        "powershell",
                        "-Command",
                        "(Get-WmiObject MSAcpi_ThermalZoneTemperature -Namespace root/wmi).CurrentTemperature",
                    ],
                    capture_output=True,
                    text=True,
                    timeout=3,
                )
                if r.returncode == 0 and r.stdout.strip():
                    raw = float(r.stdout.strip().split("\n")[0])
                    return (raw / 10.0) - 273.15
            except Exception:
                pass

        return -1.0

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "cpu": self.cpu,
                "mem": self.mem,
                "net": self.net,
                "gpu": self.gpu,
                "tmp": self.tmp,
            }


_metrics = _SysMetrics()


class HudCanvas(QWidget):
    def __init__(self, face_path: str, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_OpaquePaintEvent)
        self.setMinimumSize(300, 300)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)

        self.muted = False
        self.speaking = False
        self.state = "INITIALISING"

        self._tick = 0
        self._scale = 1.0
        self._tgt_scale = 1.0
        self._halo = 55.0
        self._tgt_halo = 55.0
        self._last_t = time.time()
        self._scan = 0.0
        self._scan2 = 180.0
        self._rings = [0.0, 120.0, 240.0]
        self._pulses: list[float] = [0.0, 50.0, 100.0]
        self._blink = True
        self._blink_tick = 0
        self._particles: list[list[float]] = []
        self._face_px: QPixmap | None = None
        self._load_face(face_path)

        self._tmr = QTimer(self)
        self._tmr.timeout.connect(self._step)
        self._tmr.start(16)

    def _load_face(self, path: str):
        try:
            from PIL import Image, ImageDraw
            import io

            img = Image.open(path).convert("RGBA")
            sz = min(img.size)
            img = img.resize((sz, sz), Image.LANCZOS)
            mk = Image.new("L", (sz, sz), 0)
            ImageDraw.Draw(mk).ellipse((2, 2, sz - 2, sz - 2), fill=255)
            img.putalpha(mk)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            px = QPixmap()
            px.loadFromData(buf.getvalue())
            self._face_px = px
        except Exception:
            self._face_px = None

    def _step(self):
        self._tick += 1
        now = time.time()
        if now - self._last_t > (0.12 if self.speaking else 0.5):
            if self.speaking:
                self._tgt_scale = random.uniform(1.06, 1.14)
                self._tgt_halo = random.uniform(145, 190)
            elif self.muted:
                self._tgt_scale = random.uniform(0.998, 1.002)
                self._tgt_halo = random.uniform(15, 28)
            else:
                self._tgt_scale = random.uniform(1.001, 1.008)
                self._tgt_halo = random.uniform(48, 68)
            self._last_t = now

        sp = 0.38 if self.speaking else 0.15
        self._scale += (self._tgt_scale - self._scale) * sp
        self._halo += (self._tgt_halo - self._halo) * sp

        speeds = [1.3, -0.9, 2.0] if self.speaking else [0.55, -0.35, 0.9]
        for i, spd in enumerate(speeds):
            self._rings[i] = (self._rings[i] + spd) % 360

        self._scan = (self._scan + (3.0 if self.speaking else 1.3)) % 360
        self._scan2 = (self._scan2 + (-2.0 if self.speaking else -0.75)) % 360

        fw = min(self.width(), self.height())
        lim = fw * 0.74
        spd = 4.2 if self.speaking else 2.0
        self._pulses = [r + spd for r in self._pulses if r + spd < lim]
        if len(self._pulses) < 3 and random.random() < (
            0.07 if self.speaking else 0.025
        ):
            self._pulses.append(0.0)

        if self.speaking and random.random() < 0.28:
            cx, cy = self.width() / 2, self.height() / 2
            ang = random.uniform(0, 2 * math.pi)
            r_s = fw * 0.28
            self._particles.append(
                [
                    cx + math.cos(ang) * r_s,
                    cy + math.sin(ang) * r_s,
                    math.cos(ang) * random.uniform(0.9, 2.4),
                    math.sin(ang) * random.uniform(0.9, 2.4) - 0.4,
                    1.0,
                ]
            )
        self._particles = [
            [p[0] + p[2], p[1] + p[3], p[2] * 0.97, p[3] * 0.97, p[4] - 0.028]
            for p in self._particles
            if p[4] > 0
        ]

        self._blink_tick += 1
        if self._blink_tick >= 38:
            self._blink = not self._blink
            self._blink_tick = 0
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.fillRect(self.rect(), qcol(C.BG))

        W, H = self.width(), self.height()
        cx, cy = W / 2, H / 2
        fw = min(W, H)

        # grid dots
        p.setPen(QPen(qcol(C.PRI_GHO), 1))
        for x in range(0, W, 48):
            for y in range(0, H, 48):
                p.drawPoint(x, y)

        r_face = fw * 0.31

        # halo glow
        for i in range(10):
            r = r_face * (1.8 - i * 0.08)
            frc = 1.0 - i / 10
            a = max(0, min(255, int(self._halo * 0.085 * frc)))
            col = qcol(C.MUTED_C if self.muted else C.PRI, a)
            p.setPen(QPen(col, 1.5))
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.drawEllipse(QRectF(cx - r, cy - r, r * 2, r * 2))

        # pulse rings
        for pr in self._pulses:
            a = max(0, int(230 * (1.0 - pr / (fw * 0.74))))
            col = qcol(C.MUTED_C if self.muted else C.PRI, a)
            p.setPen(QPen(col, 1.5))
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.drawEllipse(QRectF(cx - pr, cy - pr, pr * 2, pr * 2))

        # spinning arc rings
        for idx, (r_frac, w_r, arc_l, gap) in enumerate(
            [(0.48, 3, 115, 78), (0.40, 2, 78, 55), (0.32, 1, 56, 40)]
        ):
            ring_r = fw * r_frac
            base = self._rings[idx]
            a_val = max(0, min(255, int(self._halo * (1.0 - idx * 0.18))))
            col = qcol(C.MUTED_C if self.muted else C.PRI, a_val)
            p.setPen(QPen(col, w_r))
            p.setBrush(Qt.BrushStyle.NoBrush)
            angle = base
            rect = QRectF(cx - ring_r, cy - ring_r, ring_r * 2, ring_r * 2)
            while angle < base + 360:
                p.drawArc(rect, int(angle * 16), int(arc_l * 16))
                angle += arc_l + gap

        # scanners
        sr = fw * 0.50
        sa = min(255, int(self._halo * 1.5))
        ex = 75 if self.speaking else 44
        p.setPen(QPen(qcol(C.MUTED_C if self.muted else C.PRI, sa), 2.5))
        p.setBrush(Qt.BrushStyle.NoBrush)
        srect = QRectF(cx - sr, cy - sr, sr * 2, sr * 2)
        p.drawArc(srect, int(self._scan * 16), int(ex * 16))
        p.setPen(QPen(qcol(C.ACC, sa // 2), 1.5))
        p.drawArc(srect, int(self._scan2 * 16), int(ex * 16))

        # tick marks
        t_out, t_in = fw * 0.497, fw * 0.474
        p.setPen(QPen(qcol(C.PRI, 140), 1))
        for deg in range(0, 360, 10):
            rad = math.radians(deg)
            inn = t_in if deg % 30 == 0 else t_in + 6
            p.drawLine(
                QPointF(cx + t_out * math.cos(rad), cy - t_out * math.sin(rad)),
                QPointF(cx + inn * math.cos(rad), cy - inn * math.sin(rad)),
            )

        # crosshair
        ch_r, gap_h = fw * 0.51, fw * 0.16
        p.setPen(QPen(qcol(C.PRI, int(self._halo * 0.5)), 1))
        p.drawLine(QPointF(cx - ch_r, cy), QPointF(cx - gap_h, cy))
        p.drawLine(QPointF(cx + gap_h, cy), QPointF(cx + ch_r, cy))
        p.drawLine(QPointF(cx, cy - ch_r), QPointF(cx, cy - gap_h))
        p.drawLine(QPointF(cx, cy + gap_h), QPointF(cx, cy + ch_r))

        # corner brackets
        bl = 24
        bc = qcol(C.PRI, 210)
        hl, hr = cx - fw // 2, cx + fw // 2
        ht, hb = cy - fw // 2, cy + fw // 2
        p.setPen(QPen(bc, 2))
        for bx, by, dx, dy in [
            (hl, ht, 1, 1),
            (hr, ht, -1, 1),
            (hl, hb, 1, -1),
            (hr, hb, -1, -1),
        ]:
            p.drawLine(QPointF(bx, by), QPointF(bx + dx * bl, by))
            p.drawLine(QPointF(bx, by), QPointF(bx, by + dy * bl))

        # face
        if self._face_px:
            fsz = int(fw * 0.62 * self._scale)
            scaled = self._face_px.scaled(
                fsz,
                fsz,
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            p.drawPixmap(int(cx - fsz / 2), int(cy - fsz / 2), scaled)
        else:
            orb_r = int(fw * 0.27 * self._scale)
            oc = (200, 0, 50) if self.muted else (0, 60, 110)
            for i in range(8, 0, -1):
                r2 = int(orb_r * i / 8)
                frc = i / 8
                a = max(0, min(255, int(self._halo * 1.1 * frc)))
                p.setBrush(
                    QBrush(
                        QColor(int(oc[0] * frc), int(oc[1] * frc), int(oc[2] * frc), a)
                    )
                )
                p.setPen(Qt.PenStyle.NoPen)
                p.drawEllipse(QRectF(cx - r2, cy - r2, r2 * 2, r2 * 2))
            p.setPen(QPen(qcol(C.PRI, min(255, int(self._halo * 2))), 1))
            p.setFont(QFont("Calibri", 13, QFont.Weight.Bold))
            p.drawText(
                QRectF(cx - 80, cy - 14, 160, 28),
                Qt.AlignmentFlag.AlignCenter,
                "T.R.A.V.I.S",
            )

        # particles
        for pt in self._particles:
            a = max(0, min(255, int(pt[4] * 255)))
            p.setPen(Qt.PenStyle.NoPen)
            p.setBrush(QBrush(qcol(C.PRI, a)))
            p.drawEllipse(QPointF(pt[0], pt[1]), 2.5, 2.5)

        # status text
        sy = cy + fw * 0.40
        if self.muted:
            txt, col = "⊘  MUTED", qcol(C.MUTED_C)
        elif self.speaking:
            txt, col = "●  SPEAKING", qcol(C.ACC)
        elif self.state == "THINKING":
            sym = "◈" if self._blink else "◇"
            txt, col = f"{sym}  THINKING", qcol(C.ACC2)
        elif self.state == "PROCESSING":
            sym = "▷" if self._blink else "▶"
            txt, col = f"{sym}  PROCESSING", qcol(C.ACC2)
        elif self.state == "LISTENING":
            sym = "●" if self._blink else "○"
            txt, col = f"{sym}  LISTENING", qcol(C.GREEN)
        else:
            sym = "●" if self._blink else "○"
            txt, col = f"{sym}  {self.state}", qcol(C.PRI)

        p.setPen(QPen(col, 1))
        p.setFont(QFont("Calibri", 11, QFont.Weight.Bold))
        p.drawText(QRectF(0, sy, W, 26), Qt.AlignmentFlag.AlignCenter, txt)

        # waveform
        wy = sy + 30
        N, bw = 36, 8
        wx0 = (W - N * bw) / 2
        for i in range(N):
            if self.muted:
                hgt, cl = 2, qcol(C.MUTED_C)
            elif self.speaking:
                hgt = random.randint(3, 20)
                cl = qcol(C.PRI) if hgt > 12 else qcol(C.PRI_DIM)
            else:
                hgt = int(3 + 2 * math.sin(self._tick * 0.09 + i * 0.6))
                cl = qcol(C.BORDER_B)
            p.fillRect(QRectF(wx0 + i * bw, wy + 20 - hgt, bw - 1, hgt), cl)


class VisualPanel(QWidget):
    """A general on-screen "visual card" surface.

    TRAVIS pushes a payload dict and this draws it, so a visitor can *see* what's
    being explained instead of only hearing it. Four card kinds are supported:

      * "cube"  — a Rubik's move: the active face (3x3 colours) with a turn arrow,
                  plus the unfolded cube net with that face outlined.
      * "capabilities" — the TRAVIS product dashboard with experience modules.
      * "steps" — a numbered, navigable how-to card (heading + detail) for any
                  assembly / information walkthrough.
      * "image" — a single picture from a local path or URL, with a caption.

    Rendering is self-contained (QPainter) and styled to match the HUD palette.
    """

    _img_loaded = pyqtSignal(object)  # emits a QPixmap when a URL fetch finishes

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_OpaquePaintEvent)
        self.setMinimumSize(300, 300)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding)
        self._card: dict | None = None
        self._pixmap: QPixmap | None = None
        self._pixmap_src: str | None = None
        self._img_loaded.connect(self._on_img_loaded)

    # -- public API ---------------------------------------------------------
    def set_card(self, payload: dict):
        self._card = dict(payload or {})
        if (self._card.get("kind") or "").lower() == "image":
            self._ensure_pixmap()
        else:
            self._pixmap = None
            self._pixmap_src = None
        self.update()

    # -- image loading ------------------------------------------------------
    def _ensure_pixmap(self):
        card = self._card or {}
        path = card.get("path")
        url = card.get("url") or card.get("image_url")
        src = self._local_image_cache_key(path) if path else url
        if not src or src == self._pixmap_src:
            return
        self._pixmap_src = src
        self._pixmap = None
        if path:
            img = QImage(str(path))
            self._pixmap = QPixmap.fromImage(img) if not img.isNull() else None
        elif url:
            threading.Thread(target=self._fetch_url, args=(url,), daemon=True).start()

    def _local_image_cache_key(self, path) -> str:
        """Stable identity for local images, including overwritten file changes."""
        p = Path(str(path))
        try:
            st = p.stat()
            return f"{p}|{st.st_mtime_ns}|{st.st_size}"
        except OSError:
            return str(p)

    def _fetch_url(self, url: str):
        try:
            import urllib.request

            with urllib.request.urlopen(url, timeout=8) as resp:
                data = resp.read()
            px = QPixmap()
            if px.loadFromData(data) and not px.isNull():
                self._img_loaded.emit(px)
        except Exception:
            pass

    def _on_img_loaded(self, px: QPixmap):
        self._pixmap = px
        self.update()

    # -- painting -----------------------------------------------------------
    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.fillRect(self.rect(), qcol(C.BG))

        # subtle grid dots, matching the HUD backdrop
        p.setPen(QPen(qcol(C.PRI_GHO), 1))
        for x in range(0, self.width(), 48):
            for y in range(0, self.height(), 48):
                p.drawPoint(x, y)

        card = self._card
        if not card:
            self._paint_empty(p)
            return

        kind = (card.get("kind") or "steps").lower()
        if kind == "cube":
            self._paint_cube(p, card)
        elif kind == "capabilities":
            self._paint_capabilities(p, card)
        elif kind == "image":
            self._paint_image(p, card)
        else:
            self._paint_steps(p, card)

    def _paint_empty(self, p: QPainter):
        p.setPen(QPen(qcol(C.TEXT_DIM), 1))
        p.setFont(QFont("Calibri", 12, QFont.Weight.Bold))
        p.drawText(self.rect(), Qt.AlignmentFlag.AlignCenter, "◇  NO VISUAL")

    def _paint_capabilities(self, p: QPainter, card: dict):
        self._header(p, card.get("title") or "TRAVIS")
        W, H = self.width(), self.height()

        p.setPen(QPen(qcol(C.WHITE), 1))
        p.setFont(QFont("Calibri", 34, QFont.Weight.Bold))
        p.drawText(QRectF(0, 78, W, 48), Qt.AlignmentFlag.AlignHCenter, "TRAVIS")
        p.setPen(QPen(qcol(C.PRI), 1))
        p.setFont(QFont("Calibri", 10, QFont.Weight.Bold))
        p.drawText(
            QRectF(0, 126, W, 24), Qt.AlignmentFlag.AlignHCenter, "EXPERIENCE CENTER AI"
        )

        p.setPen(QPen(qcol(C.TEXT_MED), 1))
        p.setFont(QFont("Calibri", 12, QFont.Weight.Bold))
        p.drawText(
            QRectF(42, 164, W - 84, 30),
            Qt.AlignmentFlag.AlignHCenter,
            card.get("subtitle") or "Systems ready. Welcome.",
        )

        modules = card.get("modules") or []
        if not modules:
            modules = [
                {
                    "label": "Cube Coach",
                    "status": "ready",
                    "description": "Rubik's cube guidance",
                },
                {
                    "label": "Face Recognition",
                    "status": "ready",
                    "description": "Visitor memory",
                },
                {
                    "label": "LEGO Coach",
                    "status": "prototype",
                    "description": "Guided builds",
                },
                {
                    "label": "Photo Puzzle",
                    "status": "ready",
                    "description": "Hand-tracking puzzle",
                },
            ]

        cols = 2 if W >= 620 else 1
        gap = 18
        left = 40
        top = 218
        card_w = (W - left * 2 - gap * (cols - 1)) / cols
        card_h = max(98, min(136, (H - top - 76 - gap) / 2))

        for i, item in enumerate(modules[:6]):
            row, col = divmod(i, cols)
            x = left + col * (card_w + gap)
            y = top + row * (card_h + gap)
            rect = QRectF(x, y, card_w, card_h)
            status = str(item.get("status") or "ready").upper()
            ready = status == "READY"
            accent = C.GREEN if ready else C.PRI
            if "PROTOTYPE" in status:
                accent = C.ACC

            p.setBrush(qcol(C.PANEL2, 235))
            p.setPen(QPen(qcol(accent, 160), 1))
            p.drawRoundedRect(rect, 8, 8)

            p.setPen(QPen(qcol(C.WHITE), 1))
            p.setFont(QFont("Calibri", 14, QFont.Weight.Bold))
            p.drawText(
                QRectF(x + 18, y + 18, card_w - 36, 26),
                Qt.AlignmentFlag.AlignLeft,
                str(item.get("label") or "Module"),
            )

            p.setPen(QPen(qcol(C.TEXT_MED), 1))
            p.setFont(QFont("Calibri", 9, QFont.Weight.Bold))
            p.drawText(
                QRectF(x + 18, y + 50, card_w - 36, 36),
                int(Qt.AlignmentFlag.AlignLeft | Qt.TextFlag.TextWordWrap),
                str(item.get("description") or ""),
            )

            badge = QRectF(x + 18, y + card_h - 32, min(130, card_w - 36), 20)
            p.setBrush(qcol(accent, 38))
            p.setPen(QPen(qcol(accent, 190), 1))
            p.drawRoundedRect(badge, 6, 6)
            p.setPen(QPen(qcol(accent), 1))
            p.setFont(QFont("Calibri", 8, QFont.Weight.Bold))
            p.drawText(badge, Qt.AlignmentFlag.AlignCenter, status)

        p.setPen(QPen(qcol(C.TEXT_DIM), 1))
        p.setFont(QFont("Calibri", 9, QFont.Weight.Bold))
        p.drawText(
            QRectF(30, H - 46, W - 60, 24),
            Qt.AlignmentFlag.AlignHCenter,
            "Say: open Photo Puzzle, scan visitors, help me solve this cube.",
        )

    def _header(self, p: QPainter, title: str, progress: str = ""):
        W = self.width()
        p.fillRect(QRectF(0, 0, W, 46), qcol(C.DARK))
        p.setPen(QPen(qcol(C.BORDER_B), 1))
        p.drawLine(0, 46, W, 46)
        p.setPen(QPen(qcol(C.PRI), 1))
        p.setFont(QFont("Calibri", 13, QFont.Weight.Bold))
        p.drawText(
            QRectF(16, 0, W - 220, 46),
            Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
            title,
        )
        if progress:
            p.setPen(QPen(qcol(C.GREEN), 1))
            p.setFont(QFont("Calibri", 11, QFont.Weight.Bold))
            p.drawText(
                QRectF(W - 210, 0, 194, 46),
                Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter,
                progress,
            )

    # -- cube card ----------------------------------------------------------
    def _paint_cube(self, p: QPainter, card: dict):
        idx = int(card.get("index") or 0)
        total = int(card.get("total") or 0)
        face = (card.get("face") or "").upper()
        prog = f"Move {idx} / {total}" if total else ""
        self._header(p, "TRAVIS · Cube Coach", prog)

        W, H = self.width(), self.height()

        # Active face, drawn straight-on, with the turn arrow around it.
        grid = card.get("face_grid")
        big = max(40, int(min(W, H) * 0.12))
        fx = W // 2 - (3 * big) // 2
        fy = 86
        if grid and len(grid) == 9:
            self._draw_cells(p, grid, fx, fy, big, gap=4)
            p.setPen(QPen(qcol(C.ACC2), 3))
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.drawRect(fx - 3, fy - 3, 3 * big + 6, 3 * big + 6)
        cx, cy = fx + 3 * big // 2, fy + 3 * big // 2
        self._draw_rotation_arrow(
            p, (cx, cy), int(big * 1.55), card.get("direction", "CW")
        )

        # Instruction lines under the face.
        col_name = (card.get("color") or "").upper()
        turn = {
            "CW": "CLOCKWISE",
            "CCW": "ANTI-CLOCKWISE",
            "180": "HALF TURN (180°)",
        }.get(card.get("direction"), "")
        ty = fy + 3 * big + 56
        p.setPen(QPen(qcol(C.WHITE), 1))
        p.setFont(QFont("Calibri", 15, QFont.Weight.Bold))
        p.drawText(
            QRectF(0, ty, W, 30),
            Qt.AlignmentFlag.AlignHCenter,
            f"Turn the {col_name} face" if col_name else "Re-orient the cube",
        )
        face_code = (card.get("color") or " ")[0].lower()
        p.setPen(QPen(qcol(_STICKER_HEX.get(face_code, C.PRI)), 1))
        p.setFont(QFont("Calibri", 19, QFont.Weight.Bold))
        p.drawText(QRectF(0, ty + 30, W, 36), Qt.AlignmentFlag.AlignHCenter, turn)
        where = card.get("where") or ""
        if where:
            p.setPen(QPen(qcol(C.TEXT_MED), 1))
            p.setFont(QFont("Calibri", 10, QFont.Weight.Bold))
            p.drawText(QRectF(0, ty + 70, W, 22), Qt.AlignmentFlag.AlignHCenter, where)
        notation = card.get("notation")
        if notation:
            p.setPen(QPen(qcol(C.PRI), 1))
            p.setFont(QFont("Calibri", 12, QFont.Weight.Bold))
            p.drawText(
                QRectF(0, ty + 94, W, 22),
                Qt.AlignmentFlag.AlignHCenter,
                f"[ {notation} ]",
            )

        # Reference cube map (the unfolded net), active face outlined.
        state = card.get("state")
        if state and len(state) == 54:
            ncell = max(12, int(min(W, H) * 0.035))
            net_w = 12 * ncell
            nx = W // 2 - net_w // 2
            ny = H - 7 * ncell - 28
            p.setPen(QPen(qcol(C.TEXT_DIM), 1))
            p.setFont(QFont("Calibri", 9, QFont.Weight.Bold))
            p.drawText(
                QRectF(nx, ny - 18, net_w, 16), Qt.AlignmentFlag.AlignLeft, "Cube map"
            )
            self._draw_net(p, state, nx, ny, ncell, active=face)

    def _draw_cells(
        self, p: QPainter, grid: str, x0: int, y0: int, cell: int, gap: int = 2
    ):
        for i, ch in enumerate(grid):
            r, c = divmod(i, 3)
            x, y = x0 + c * cell, y0 + r * cell
            p.fillRect(
                QRectF(x, y, cell - gap, cell - gap),
                qcol(_STICKER_HEX.get(ch, "#6e6e6e")),
            )
            p.setPen(QPen(qcol("#191919"), 1))
            p.setBrush(Qt.BrushStyle.NoBrush)
            p.drawRect(QRectF(x, y, cell - gap, cell - gap))

    def _draw_net(
        self,
        p: QPainter,
        state: str,
        ox: int,
        oy: int,
        cell: int,
        active: str | None = None,
    ):
        faces = {
            "U": state[0:9],
            "L": state[9:18],
            "F": state[18:27],
            "R": state[27:36],
            "B": state[36:45],
            "D": state[45:54],
        }
        for f, (R, C_) in _NET_POS.items():
            self._draw_cells(p, faces[f], ox + C_ * cell, oy + R * cell, cell, gap=1)
            if f == active:
                x0, y0 = ox + C_ * cell, oy + R * cell
                p.setPen(QPen(qcol(C.ACC2), 3))
                p.setBrush(Qt.BrushStyle.NoBrush)
                p.drawRect(QRectF(x0 - 2, y0 - 2, 3 * cell + 3, 3 * cell + 3))

    def _draw_rotation_arrow(self, p: QPainter, center, radius: int, direction: str):
        """Curved turn arrow. Image y is down, so increasing angle sweeps CW."""
        cx, cy = center
        if direction == "180":
            spans = [(210, 350)]
        elif direction == "CCW":
            spans = [(210, -40)]
        else:  # CW
            spans = [(-40, 210)]
        pen = QPen(qcol(C.PRI), 6)
        pen.setCapStyle(Qt.PenCapStyle.RoundCap)
        p.setPen(pen)
        p.setBrush(Qt.BrushStyle.NoBrush)
        for a0, a1 in spans:
            n = 48
            pts = []
            for k in range(n):
                t = math.radians(a0 + (a1 - a0) * k / (n - 1))
                pts.append(
                    QPointF(cx + radius * math.cos(t), cy + radius * math.sin(t))
                )
            p.drawPolyline(QPolygonF(pts))
            self._arrowhead(p, pts[-3], pts[-1])
            if direction == "180":
                self._arrowhead(p, pts[2], pts[0])

    def _arrowhead(self, p: QPainter, p0: QPointF, p1: QPointF, size: int = 22):
        ang = math.atan2(p1.y() - p0.y(), p1.x() - p0.x())
        for da in (math.radians(148), -math.radians(148)):
            x = p1.x() + size * math.cos(ang + da)
            y = p1.y() + size * math.sin(ang + da)
            p.drawLine(p1, QPointF(x, y))

    # -- steps card ---------------------------------------------------------
    def _paint_steps(self, p: QPainter, card: dict):
        steps = card.get("steps") or []
        idx = max(0, min(int(card.get("index") or 0), max(0, len(steps) - 1)))
        total = len(steps)
        prog = f"Step {idx + 1} / {total}" if total else ""
        self._header(p, card.get("title") or "TRAVIS · Visual", prog)

        W, H = self.width(), self.height()
        if not steps:
            p.setPen(QPen(qcol(C.TEXT_DIM), 1))
            p.setFont(QFont("Calibri", 12, QFont.Weight.Bold))
            p.drawText(
                self.rect(), Qt.AlignmentFlag.AlignCenter, card.get("title") or ""
            )
            return

        step = steps[idx]
        heading = step.get("heading") if isinstance(step, dict) else str(step)
        detail = step.get("detail", "") if isinstance(step, dict) else ""
        highlight = step.get("highlight", "") if isinstance(step, dict) else ""

        # Big card body.
        m = 40
        cardrect = QRectF(m, 80, W - 2 * m, H - 80 - 70)
        p.setBrush(qcol(C.PANEL2))
        p.setPen(QPen(qcol(C.BORDER_A), 1))
        p.drawRoundedRect(cardrect, 8, 8)

        # Big step number badge.
        p.setBrush(qcol(C.PRI_GHO))
        p.setPen(QPen(qcol(C.PRI), 2))
        p.drawEllipse(QRectF(m + 24, 104, 64, 64))
        p.setPen(QPen(qcol(C.PRI), 1))
        p.setFont(QFont("Calibri", 24, QFont.Weight.Bold))
        p.drawText(
            QRectF(m + 24, 104, 64, 64), Qt.AlignmentFlag.AlignCenter, str(idx + 1)
        )

        tx = m + 110
        tw = int(cardrect.right() - tx - 24)
        p.setPen(QPen(qcol(C.WHITE), 1))
        p.setFont(QFont("Calibri", 17, QFont.Weight.Bold))
        p.drawText(
            QRectF(tx, 108, tw, 60),
            int(
                Qt.AlignmentFlag.AlignLeft
                | Qt.AlignmentFlag.AlignVCenter
                | Qt.TextFlag.TextWordWrap
            ),
            heading or "",
        )

        if detail:
            p.setPen(QPen(qcol(C.TEXT), 1))
            p.setFont(QFont("Calibri", 12, QFont.Weight.Bold))
            p.drawText(
                QRectF(m + 24, 188, cardrect.width() - 48, cardrect.height() - 130),
                int(
                    Qt.AlignmentFlag.AlignLeft
                    | Qt.AlignmentFlag.AlignTop
                    | Qt.TextFlag.TextWordWrap
                ),
                detail,
            )

        if highlight:
            p.setPen(QPen(qcol(C.ACC2), 1))
            p.setFont(QFont("Calibri", 12, QFont.Weight.Bold))
            p.drawText(
                QRectF(m + 24, cardrect.bottom() - 44, cardrect.width() - 48, 32),
                int(Qt.AlignmentFlag.AlignLeft | Qt.TextFlag.TextWordWrap),
                f"➤ {highlight}",
            )

        # Step dots.
        dot_y = H - 44
        dr = 7
        gap = 22
        total_w = total * gap
        x0 = W // 2 - total_w // 2
        for i in range(total):
            p.setBrush(qcol(C.PRI) if i == idx else qcol(C.BORDER_B))
            p.setPen(Qt.PenStyle.NoPen)
            p.drawEllipse(QRectF(x0 + i * gap, dot_y, dr, dr))

    # -- image card ---------------------------------------------------------
    def _paint_image(self, p: QPainter, card: dict):
        self._header(p, card.get("title") or "TRAVIS · Visual")
        W, H = self.width(), self.height()
        cap = card.get("caption") or ""
        area = QRectF(20, 60, W - 40, H - 60 - (40 if cap else 16))
        if self._pixmap is not None and not self._pixmap.isNull():
            scaled = self._pixmap.scaled(
                int(area.width()),
                int(area.height()),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            x = area.x() + (area.width() - scaled.width()) / 2
            y = area.y() + (area.height() - scaled.height()) / 2
            p.drawPixmap(int(x), int(y), scaled)
        else:
            p.setPen(QPen(qcol(C.TEXT_DIM), 1))
            p.setFont(QFont("Calibri", 12, QFont.Weight.Bold))
            p.drawText(area, Qt.AlignmentFlag.AlignCenter, "loading image…")
        if cap:
            p.setPen(QPen(qcol(C.TEXT_MED), 1))
            p.setFont(QFont("Calibri", 11, QFont.Weight.Bold))
            p.drawText(
                QRectF(20, H - 40, W - 40, 28), Qt.AlignmentFlag.AlignHCenter, cap
            )


class MetricBar(QWidget):
    def __init__(self, label: str, color: str = C.PRI, parent=None):
        super().__init__(parent)
        self._label = label
        self._color = color
        self._value = 0.0  # 0–100
        self._text = "--"
        self.setFixedHeight(38)
        self.setMinimumWidth(80)

    def set_value(self, pct: float, text: str):
        self._value = max(0.0, min(100.0, pct))
        self._text = text
        self.update()

    def paintEvent(self, _):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        W, H = self.width(), self.height()

        p.setBrush(QBrush(qcol(C.PANEL2)))
        p.setPen(QPen(qcol(C.BORDER_A), 1))
        p.drawRoundedRect(QRectF(1, 1, W - 2, H - 2), 4, 4)

        bar_h = 4
        bar_y = H - bar_h - 5
        bar_w = W - 12
        bar_x = 6
        fill_w = int(bar_w * self._value / 100)

        p.setBrush(QBrush(qcol(C.BAR_BG)))
        p.setPen(Qt.PenStyle.NoPen)
        p.drawRoundedRect(QRectF(bar_x, bar_y, bar_w, bar_h), 2, 2)

        if self._value > 85:
            bar_col = qcol(C.RED)
        elif self._value > 65:
            bar_col = qcol(C.ACC)
        else:
            bar_col = qcol(self._color)

        if fill_w > 0:
            p.setBrush(QBrush(bar_col))
            p.drawRoundedRect(QRectF(bar_x, bar_y, fill_w, bar_h), 2, 2)

        p.setFont(QFont("Calibri", 7, QFont.Weight.Bold))
        p.setPen(QPen(qcol(C.TEXT_DIM), 1))
        p.drawText(
            QRectF(8, 5, 50, 14),
            Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter,
            self._label,
        )

        p.setFont(QFont("Calibri", 9, QFont.Weight.Bold))
        p.setPen(QPen(bar_col if self._text != "--" else qcol(C.TEXT_DIM), 1))
        p.drawText(
            QRectF(0, 4, W - 6, 16),
            Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter,
            self._text,
        )


class LogWidget(QTextEdit):
    _sig = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setReadOnly(True)
        self.setFont(QFont("Calibri", 9, QFont.Weight.Bold))
        self.setStyleSheet(f"""
            QTextEdit {{
                background: {C.PANEL};
                color: {C.TEXT};
                border: 1px solid {C.BORDER};
                border-radius: 4px;
                padding: 6px;
                selection-background-color: {C.PRI_GHO};
            }}
            QScrollBar:vertical {{
                background: {C.BG};
                width: 8px;
                border: none;
            }}
            QScrollBar::handle:vertical {{
                background: {C.BORDER_B};
                border-radius: 4px;
                min-height: 20px;
            }}
        """)
        self._queue: list[str] = []
        self._typing = False
        self._text = ""
        self._pos = 0
        self._tag = "sys"
        self._tmr = QTimer(self)
        self._tmr.timeout.connect(self._step)
        self._sig.connect(self._enqueue)

    def append_log(self, text: str):
        self._sig.emit(text)

    def _enqueue(self, text: str):
        self._queue.append(text)
        if not self._typing:
            self._next()

    def _next(self):
        if not self._queue:
            self._typing = False
            return
        self._typing = True
        self._text = self._queue.pop(0)
        self._pos = 0
        tl = self._text.lower()
        if tl.startswith("you:"):
            self._tag = "you"
        elif tl.startswith(("travis:", "jarvis:")):
            self._tag = "ai"
        elif tl.startswith("file:"):
            self._tag = "file"
        elif "err" in tl:
            self._tag = "err"
        else:
            self._tag = "sys"
        self._tmr.start(6)

    def _step(self):
        if self._pos < len(self._text):
            ch = self._text[self._pos]
            cur = self.textCursor()
            fmt = cur.charFormat()
            col = {
                "you": qcol(C.WHITE),
                "ai": qcol(C.PRI),
                "err": qcol(C.RED),
                "file": qcol(C.GREEN),
                "sys": qcol(C.ACC2),
            }.get(self._tag, qcol(C.TEXT))
            fmt.setForeground(QBrush(col))
            cur.movePosition(cur.MoveOperation.End)
            cur.insertText(ch, fmt)
            self.setTextCursor(cur)
            self.ensureCursorVisible()
            self._pos += 1
        else:
            self._tmr.stop()
            cur = self.textCursor()
            cur.movePosition(cur.MoveOperation.End)
            cur.insertText("\n")
            self.setTextCursor(cur)
            self.ensureCursorVisible()
            QTimer.singleShot(20, self._next)


class SetupOverlay(QWidget):
    done = pyqtSignal(str, str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self.setStyleSheet(f"""
            SetupOverlay {{
                background: rgba(0, 6, 10, 245);
                border: 1px solid {C.BORDER_B};
                border-radius: 6px;
            }}
        """)

        detected = {"darwin": "mac", "windows": "windows"}.get(_OS.lower(), "linux")
        self._sel_os = detected

        layout = QVBoxLayout(self)
        layout.setContentsMargins(30, 22, 30, 22)
        layout.setSpacing(8)

        def _lbl(
            txt, font_size=9, bold=True, color=C.PRI, align=Qt.AlignmentFlag.AlignCenter
        ):
            w = QLabel(txt)
            w.setAlignment(align)
            w.setFont(QFont("Calibri", font_size, QFont.Weight.Bold))
            w.setStyleSheet(f"color: {color}; background: transparent;")
            return w

        layout.addWidget(_lbl("◈  INITIALISATION REQUIRED", 13, True))
        layout.addWidget(
            _lbl("Configure TRAVIS before first boot.", 9, color=C.PRI_DIM)
        )
        layout.addSpacing(6)

        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet(f"color: {C.BORDER};")
        layout.addWidget(sep)
        layout.addSpacing(4)

        layout.addWidget(
            _lbl(
                "GEMINI API KEY", 8, color=C.TEXT_DIM, align=Qt.AlignmentFlag.AlignLeft
            )
        )
        self._key_input = QLineEdit()
        self._key_input.setEchoMode(QLineEdit.EchoMode.Password)
        self._key_input.setPlaceholderText("AIza…")
        self._key_input.setFont(QFont("Calibri", 10, QFont.Weight.Bold))
        self._key_input.setFixedHeight(32)
        self._key_input.setStyleSheet(f"""
            QLineEdit {{
                background: #000d12; color: {C.TEXT};
                border: 1px solid {C.BORDER}; border-radius: 3px; padding: 4px 8px;
            }}
            QLineEdit:focus {{ border: 1px solid {C.PRI}; }}
        """)
        layout.addWidget(self._key_input)
        layout.addSpacing(12)

        sep2 = QFrame()
        sep2.setFrameShape(QFrame.Shape.HLine)
        sep2.setStyleSheet(f"color: {C.BORDER};")
        layout.addWidget(sep2)
        layout.addSpacing(4)

        layout.addWidget(
            _lbl(
                "OPERATING SYSTEM",
                8,
                color=C.TEXT_DIM,
                align=Qt.AlignmentFlag.AlignLeft,
            )
        )
        det_name = {"windows": "Windows", "mac": "macOS", "linux": "Linux"}[detected]
        layout.addWidget(
            _lbl(
                f"Auto-detected: {det_name}",
                8,
                color=C.ACC2,
                align=Qt.AlignmentFlag.AlignLeft,
            )
        )

        os_row = QHBoxLayout()
        os_row.setSpacing(6)
        self._os_btns: dict[str, QPushButton] = {}
        for key, label in [
            ("windows", "⊞  Windows"),
            ("mac", "  macOS"),
            ("linux", "🐧  Linux"),
        ]:
            btn = QPushButton(label)
            btn.setFont(QFont("Calibri", 9, QFont.Weight.Bold))
            btn.setFixedHeight(32)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda _, k=key: self._sel(k))
            os_row.addWidget(btn)
            self._os_btns[key] = btn
        layout.addLayout(os_row)
        self._sel(detected)
        layout.addSpacing(12)

        init_btn = QPushButton("▸  INITIALISE SYSTEMS")
        init_btn.setFont(QFont("Calibri", 10, QFont.Weight.Bold))
        init_btn.setFixedHeight(36)
        init_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        init_btn.setStyleSheet(f"""
            QPushButton {{
                background: transparent; color: {C.PRI};
                border: 1px solid {C.PRI_DIM}; border-radius: 3px;
            }}
            QPushButton:hover {{
                background: {C.PRI_GHO}; border: 1px solid {C.PRI};
            }}
        """)
        init_btn.clicked.connect(self._submit)
        layout.addWidget(init_btn)

    def _sel(self, key: str):
        self._sel_os = key
        pal = {
            "windows": (C.PRI, "#001a22"),
            "mac": (C.ACC2, "#1a1400"),
            "linux": (C.GREEN, "#001a0d"),
        }
        for k, btn in self._os_btns.items():
            if k == key:
                fg, bg = pal[k]
                btn.setStyleSheet(f"""
                    QPushButton {{
                        background: {fg}; color: {bg};
                        border: none; border-radius: 3px; font-weight: bold;
                    }}
                """)
            else:
                btn.setStyleSheet(f"""
                    QPushButton {{
                        background: #000d12; color: {C.TEXT_DIM};
                        border: 1px solid {C.BORDER}; border-radius: 3px;
                    }}
                    QPushButton:hover {{ color: {C.TEXT}; border: 1px solid {C.BORDER_B}; }}
                """)

    def _submit(self):
        key = self._key_input.text().strip()
        if not key:
            self._key_input.setStyleSheet(
                self._key_input.styleSheet()
                + f" QLineEdit {{ border: 1px solid {C.RED}; }}"
            )
            return
        self.done.emit(key, self._sel_os)


class MainWindow(QMainWindow):
    _log_sig = pyqtSignal(str)
    _state_sig = pyqtSignal(str)
    _conn_sig = pyqtSignal(str)  # "online" | "connecting" | "offline"
    _visual_sig = pyqtSignal(dict)
    _camera_sig = pyqtSignal(object)
    _camera_hide_sig = pyqtSignal()
    _visual_clear_sig = pyqtSignal()

    def __init__(self, face_path: str):
        super().__init__()
        self.setWindowTitle("TRAVIS — Experience Center Brain")
        self.setMinimumSize(_MIN_W, _MIN_H)
        self.resize(_DEFAULT_W, _DEFAULT_H)

        screen = QApplication.primaryScreen().availableGeometry()
        self.move(
            (screen.width() - _DEFAULT_W) // 2,
            (screen.height() - _DEFAULT_H) // 2,
        )

        self._muted = False

        central = QWidget()
        central.setStyleSheet(f"background: {C.BG};")
        self.setCentralWidget(central)

        root = QVBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        root.addWidget(self._build_header())

        body = QHBoxLayout()
        body.setContentsMargins(0, 0, 0, 0)
        body.setSpacing(0)

        self._left_panel = self._build_left_panel()
        body.addWidget(self._left_panel, stretch=0)

        self.hud = HudCanvas(face_path)
        self.hud.setSizePolicy(
            QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding
        )
        self._visual = VisualPanel()
        self._camera = QLabel()
        self._camera.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._camera.setStyleSheet(f"background: {C.BG};")
        self._center_stack = QStackedWidget()
        self._center_stack.setSizePolicy(
            QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Expanding
        )
        self._center_stack.addWidget(self.hud)  # index 0: default HUD face
        self._center_stack.addWidget(self._visual)  # index 1: visual card panel
        self._center_stack.addWidget(self._camera)  # index 2: live camera preview
        self._visual.set_card(self._capability_dashboard())
        self._center_stack.setCurrentWidget(self._visual)
        body.addWidget(self._center_stack, stretch=5)

        self._right_panel = self._build_right_panel()
        body.addWidget(self._right_panel, stretch=0)

        root.addLayout(body, stretch=1)
        root.addWidget(self._build_footer())

        self._clock_tmr = QTimer(self)
        self._clock_tmr.timeout.connect(self._tick_clock)
        self._clock_tmr.start(1000)
        self._tick_clock()

        # Metrik güncelleme timer'ı
        self._metric_tmr = QTimer(self)
        self._metric_tmr.timeout.connect(self._update_metrics)
        self._metric_tmr.start(2000)
        self._update_metrics()

        self._log_sig.connect(self._log.append_log)
        self._state_sig.connect(self._apply_state)
        self._conn_sig.connect(self._apply_connection)
        self._visual_sig.connect(self._show_visual)
        self._visual_clear_sig.connect(self._clear_visual)
        self._camera_sig.connect(self._on_camera_frame)
        self._camera_hide_sig.connect(self._on_camera_hide)

        self._overlay: SetupOverlay | None = None
        self._ready = self._check_config()
        if not self._ready:
            self._show_setup()

        sc_mute = QShortcut(QKeySequence("F4"), self)
        sc_mute.activated.connect(self._toggle_mute)
        sc_full = QShortcut(QKeySequence("F11"), self)
        sc_full.activated.connect(self._toggle_fullscreen)

    def _capability_dashboard(self) -> dict:
        modules = []
        path = CONFIG_DIR / "capabilities.json"
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(raw, list):
                modules = raw
        except Exception:
            modules = []
        return {
            "kind": "capabilities",
            "title": "TRAVIS · Experience Center",
            "subtitle": "Systems ready. Welcome.",
            "modules": modules,
        }

    def _toggle_fullscreen(self):
        if self.isFullScreen():
            self.showNormal()
        else:
            self.showFullScreen()

    def resizeEvent(self, event):
        super().resizeEvent(event)
        if self._overlay and self._overlay.isVisible():
            ow, oh = 460, 390
            cw = self.centralWidget()
            self._overlay.setGeometry(
                (cw.width() - ow) // 2,
                (cw.height() - oh) // 2,
                ow,
                oh,
            )

    def _update_metrics(self):
        snap = _metrics.snapshot()

        # CPU
        cpu = snap["cpu"]
        self._bar_cpu.set_value(cpu, f"{cpu:.0f}%")

        # MEM
        mem = snap["mem"]
        self._bar_mem.set_value(mem, f"{mem:.0f}%")

        # NET
        net = snap["net"]
        if net < 1.0:
            net_str = f"{net * 1024:.0f}KB/s"
        else:
            net_str = f"{net:.1f}MB/s"
        net_pct = min(100, net * 10)  # 10 MB/s = %100
        self._bar_net.set_value(net_pct, net_str)

        # GPU
        gpu = snap["gpu"]
        if gpu >= 0:
            self._bar_gpu.set_value(gpu, f"{gpu:.0f}%")
        else:
            self._bar_gpu.set_value(0, "N/A")

        # TMP
        tmp = snap["tmp"]
        if tmp >= 0:
            tmp_pct = min(100, (tmp / 100) * 100)
            self._bar_tmp.set_value(tmp_pct, f"{tmp:.0f}°C")
        else:
            self._bar_tmp.set_value(0, "N/A")

        try:
            boot_t = psutil.boot_time()
            elapsed = time.time() - boot_t
            h = int(elapsed // 3600)
            m = int((elapsed % 3600) // 60)
            self._uptime_lbl.setText(f"UP  {h:02d}:{m:02d}")
        except Exception:
            self._uptime_lbl.setText("UP  --:--")

        try:
            proc_count = len(psutil.pids())
            self._proc_lbl.setText(f"PROC  {proc_count}")
        except Exception:
            self._proc_lbl.setText("PROC  --")

    def _build_header(self) -> QWidget:
        w = QWidget()
        w.setFixedHeight(54)
        w.setStyleSheet(f"background: {C.DARK}; border-bottom: 1px solid {C.BORDER_B};")
        lay = QHBoxLayout(w)
        lay.setContentsMargins(16, 0, 16, 0)

        def _badge(txt, color=C.TEXT_MED):
            l = QLabel(txt)
            l.setFont(QFont("Calibri", 8, QFont.Weight.Bold))
            l.setStyleSheet(f"color: {color}; background: transparent;")
            return l

        lay.addWidget(_badge("EXPERIENCE CENTER", C.PRI_DIM))
        lay.addStretch()

        mid = QVBoxLayout()
        mid.setSpacing(1)
        title = QLabel("T.R.A.V.I.S")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        title.setFont(QFont("Calibri", 17, QFont.Weight.Bold))
        title.setStyleSheet(f"color: {C.PRI}; background: transparent;")
        mid.addWidget(title)
        sub = QLabel("Trusted Responsive AI Visitor Intelligence System")
        sub.setAlignment(Qt.AlignmentFlag.AlignCenter)
        sub.setFont(QFont("Calibri", 7, QFont.Weight.Bold))
        sub.setStyleSheet(f"color: {C.PRI_DIM}; background: transparent;")
        mid.addWidget(sub)
        lay.addLayout(mid)
        lay.addStretch()

        right_col = QVBoxLayout()
        right_col.setSpacing(2)
        self._clock_lbl = QLabel("00:00:00")
        self._clock_lbl.setFont(QFont("Calibri", 14, QFont.Weight.Bold))
        self._clock_lbl.setStyleSheet(f"color: {C.PRI}; background: transparent;")
        self._clock_lbl.setAlignment(Qt.AlignmentFlag.AlignRight)
        right_col.addWidget(self._clock_lbl)
        self._date_lbl = QLabel("")
        self._date_lbl.setFont(QFont("Calibri", 7, QFont.Weight.Bold))
        self._date_lbl.setStyleSheet(f"color: {C.TEXT_DIM}; background: transparent;")
        self._date_lbl.setAlignment(Qt.AlignmentFlag.AlignRight)
        right_col.addWidget(self._date_lbl)
        # Connection badge: always visible in the header (the HUD's center
        # status text is often hidden behind the visual panel). Starts OFFLINE
        # until the first Gemini Live connect succeeds.
        self._conn_lbl = QLabel("● OFFLINE")
        self._conn_lbl.setFont(QFont("Calibri", 9, QFont.Weight.Bold))
        self._conn_lbl.setStyleSheet(f"color: {C.MUTED_C}; background: transparent;")
        self._conn_lbl.setAlignment(Qt.AlignmentFlag.AlignRight)
        right_col.addWidget(self._conn_lbl)
        lay.addLayout(right_col)
        return w

    def _tick_clock(self):
        self._clock_lbl.setText(time.strftime("%H:%M:%S"))
        self._date_lbl.setText(time.strftime("%a %d %b %Y"))

    def _build_left_panel(self) -> QWidget:
        w = QWidget()
        w.setFixedWidth(_LEFT_W)
        w.setStyleSheet(f"background: {C.DARK}; border-right: 1px solid {C.BORDER};")
        lay = QVBoxLayout(w)
        lay.setContentsMargins(8, 10, 8, 10)
        lay.setSpacing(6)

        hdr = QLabel("◈ SYS MONITOR")
        hdr.setFont(QFont("Calibri", 7, QFont.Weight.Bold))
        hdr.setStyleSheet(
            f"color: {C.PRI}; background: transparent; "
            f"border-bottom: 1px solid {C.BORDER}; padding-bottom: 4px;"
        )
        lay.addWidget(hdr)
        lay.addSpacing(2)

        self._bar_cpu = MetricBar("CPU", C.PRI)
        self._bar_mem = MetricBar("MEM", C.ACC2)
        self._bar_net = MetricBar("NET", C.GREEN)
        self._bar_gpu = MetricBar("GPU", C.ACC)
        self._bar_tmp = MetricBar("TMP", "#ff6688")

        for bar in [
            self._bar_cpu,
            self._bar_mem,
            self._bar_net,
            self._bar_gpu,
            self._bar_tmp,
        ]:
            lay.addWidget(bar)

        lay.addSpacing(4)

        info_panel = QWidget()
        info_panel.setStyleSheet(
            f"background: {C.PANEL2}; border: 1px solid {C.BORDER}; border-radius: 4px;"
        )
        ip_lay = QVBoxLayout(info_panel)
        ip_lay.setContentsMargins(6, 5, 6, 5)
        ip_lay.setSpacing(3)

        self._uptime_lbl = QLabel("UP  --:--")
        self._uptime_lbl.setFont(QFont("Calibri", 8, QFont.Weight.Bold))
        self._uptime_lbl.setStyleSheet(
            f"color: {C.GREEN}; background: transparent; border: none;"
        )
        ip_lay.addWidget(self._uptime_lbl)

        self._proc_lbl = QLabel("PROC  --")
        self._proc_lbl.setFont(QFont("Calibri", 8, QFont.Weight.Bold))
        self._proc_lbl.setStyleSheet(
            f"color: {C.TEXT_MED}; background: transparent; border: none;"
        )
        ip_lay.addWidget(self._proc_lbl)

        os_name = {"Windows": "WIN", "Darwin": "macOS", "Linux": "LINUX"}.get(
            _OS, _OS.upper()
        )
        os_lbl = QLabel(f"OS  {os_name}")
        os_lbl.setFont(QFont("Calibri", 8, QFont.Weight.Bold))
        os_lbl.setStyleSheet(f"color: {C.ACC2}; background: transparent; border: none;")
        ip_lay.addWidget(os_lbl)

        lay.addWidget(info_panel)
        lay.addStretch()

        for txt, col in [
            ("AI CORE\nACTIVE", C.GREEN),
            ("SEC\nCLEARED", C.PRI),
            ("PROTOCOL\nXXXVIII", C.TEXT_DIM),
        ]:
            lbl = QLabel(txt)
            lbl.setFont(QFont("Calibri", 7, QFont.Weight.Bold))
            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            lbl.setStyleSheet(
                f"color: {col}; background: {C.PANEL2};"
                f"border: 1px solid {C.BORDER_A}; border-radius: 3px; padding: 4px;"
            )
            lay.addWidget(lbl)

        return w

    def _build_right_panel(self) -> QWidget:
        w = QWidget()
        w.setFixedWidth(_RIGHT_W)
        w.setStyleSheet(f"background: {C.DARK}; border-left: 1px solid {C.BORDER};")
        lay = QVBoxLayout(w)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)

        def _sec(txt):
            l = QLabel(f"▸ {txt}")
            l.setFont(QFont("Calibri", 7, QFont.Weight.Bold))
            l.setStyleSheet(f"color: {C.TEXT_MED}; background: transparent;")
            return l

        lay.addWidget(_sec("ACTIVITY LOG"))
        self._log = LogWidget()
        lay.addWidget(self._log, stretch=1)

        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.HLine)
        sep.setStyleSheet(f"color: {C.BORDER}; margin: 2px 0;")
        lay.addWidget(sep)

        self._mute_btn = QPushButton("🎙  MICROPHONE ACTIVE")
        self._mute_btn.setFixedHeight(30)
        self._mute_btn.setFont(QFont("Calibri", 8, QFont.Weight.Bold))
        self._mute_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._mute_btn.clicked.connect(self._toggle_mute)
        self._style_mute_btn()
        lay.addWidget(self._mute_btn)

        fs_btn = QPushButton("⛶  FULLSCREEN  [F11]")
        fs_btn.setFixedHeight(26)
        fs_btn.setFont(QFont("Calibri", 7, QFont.Weight.Bold))
        fs_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        fs_btn.setStyleSheet(f"""
            QPushButton {{
                background: transparent; color: {C.TEXT_MED};
                border: 1px solid {C.BORDER}; border-radius: 3px;
            }}
            QPushButton:hover {{
                color: {C.PRI}; border: 1px solid {C.BORDER_B};
            }}
        """)
        fs_btn.clicked.connect(self._toggle_fullscreen)
        lay.addWidget(fs_btn)

        return w

    def _build_footer(self) -> QWidget:
        w = QWidget()
        w.setFixedHeight(22)
        w.setStyleSheet(f"background: {C.DARK}; border-top: 1px solid {C.BORDER};")
        lay = QHBoxLayout(w)
        lay.setContentsMargins(14, 0, 14, 0)

        def _fl(txt, color=C.TEXT_MED):
            l = QLabel(txt)
            l.setFont(QFont("Calibri", 7, QFont.Weight.Bold))
            l.setStyleSheet(f"color: {color}; background: transparent;")
            return l

        lay.addWidget(_fl("[F4] Mute  ·  [F11] Fullscreen"))
        lay.addStretch()
        lay.addWidget(_fl("TRAVIS  ·  EXPERIENCE CENTER  ·  PRIVATE"))
        lay.addStretch()
        lay.addWidget(_fl("LOCAL AI OPERATIONS", C.PRI_DIM))
        return w

    def _toggle_mute(self):
        self._muted = not self._muted
        self.hud.muted = self._muted
        self._style_mute_btn()
        if self._muted:
            self._apply_state("MUTED")
            self._log.append_log("SYS: Microphone muted.")
        else:
            self._apply_state("LISTENING")
            self._log.append_log("SYS: Microphone active.")

    def _style_mute_btn(self):
        if self._muted:
            self._mute_btn.setText("🔇  MICROPHONE MUTED")
            self._mute_btn.setStyleSheet(f"""
                QPushButton {{
                    background: #140006; color: {C.MUTED_C};
                    border: 1px solid {C.MUTED_C}; border-radius: 3px;
                }}
            """)
        else:
            self._mute_btn.setText("🎙  MICROPHONE ACTIVE")
            self._mute_btn.setStyleSheet(f"""
                QPushButton {{
                    background: #00140a; color: {C.GREEN};
                    border: 1px solid {C.GREEN}; border-radius: 3px;
                }}
                QPushButton:hover {{ background: #001f10; }}
            """)

    def _apply_state(self, state: str):
        self.hud.state = state
        self.hud.speaking = state == "SPEAKING"

    def _apply_connection(self, status: str):
        if status == "online":
            txt, col = "● ONLINE", C.GREEN
        elif status == "connecting":
            txt, col = "● CONNECTING…", C.ACC2
        else:
            txt, col = "● OFFLINE", C.MUTED_C
        self._conn_lbl.setText(txt)
        self._conn_lbl.setStyleSheet(f"color: {col}; background: transparent;")

    def _show_visual(self, payload: dict):
        self._visual.set_card(payload)
        self._center_stack.setCurrentWidget(self._visual)

    def _clear_visual(self):
        self._center_stack.setCurrentWidget(self.hud)

    def _on_camera_frame(self, frame):
        """Render a BGR camera frame (numpy array) into the center panel."""
        try:
            h, w = frame.shape[:2]
            img = QImage(frame.tobytes(), w, h, 3 * w, QImage.Format.Format_BGR888)
            pix = QPixmap.fromImage(img)
            self._camera.setPixmap(
                pix.scaled(
                    self._camera.size(),
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation,
                )
            )
            if self._center_stack.currentWidget() is not self._camera:
                self._center_stack.setCurrentWidget(self._camera)
        except Exception:
            pass

    def _on_camera_hide(self):
        self._center_stack.setCurrentWidget(self._visual)

    def _check_config(self) -> bool:
        if not API_FILE.exists():
            return False
        try:
            d = json.loads(API_FILE.read_text(encoding="utf-8"))
            # No cloud key is required to run; gemini_api_key only enables knowledge_search.
            return bool(d.get("os_system"))
        except Exception:
            return False

    def _show_setup(self):
        ov = SetupOverlay(self.centralWidget())
        cw = self.centralWidget()
        ow, oh = 460, 430
        ov.setGeometry(
            (cw.width() - ow) // 2,
            (cw.height() - oh) // 2,
            ow,
            oh,
        )
        ov.done.connect(self._on_setup_done)
        ov.show()
        self._overlay = ov

    def _on_setup_done(self, key: str, os_name: str):
        os.makedirs(CONFIG_DIR, exist_ok=True)
        API_FILE.write_text(
            json.dumps(
                {
                    "gemini_api_key": key,
                    "os_system": os_name,
                },
                indent=4,
            ),
            encoding="utf-8",
        )
        self._ready = True
        if self._overlay:
            self._overlay.hide()
            self._overlay = None
        self._apply_state("LISTENING")
        self._log.append_log(f"SYS: Initialised. OS={os_name.upper()}. TRAVIS online.")


class _RootShim:
    def __init__(self, app: QApplication):
        self._app = app

    def mainloop(self):
        self._app.exec()

    def protocol(self, *_):
        pass


class TravisUI:
    def __init__(self, face_path: str, size=None):
        self._app = QApplication.instance() or QApplication(sys.argv)
        self._app.setStyle("Fusion")
        self._win = MainWindow(face_path)
        self._win.show()
        self.root = _RootShim(self._app)

    @property
    def muted(self) -> bool:
        try:
            return self._win._muted
        except RuntimeError:
            return True

    @muted.setter
    def muted(self, v: bool):
        try:
            if v != self._win._muted:
                self._win._toggle_mute()
        except RuntimeError:
            pass

    def set_state(self, state: str):
        try:
            self._win._state_sig.emit(state)
        except RuntimeError:
            pass

    def set_connection(self, status: str):
        """Update the header connection badge: "online" | "connecting" | "offline"."""
        try:
            self._win._conn_sig.emit(status)
        except RuntimeError:
            pass

    def write_log(self, text: str):
        try:
            self._win._log_sig.emit(text)
        except RuntimeError:
            pass

    def show_visual(self, payload: dict):
        """Display a visual card on the main screen (thread-safe)."""
        try:
            self._win._visual_sig.emit(dict(payload or {}))
        except RuntimeError:
            pass

    def show_camera_frame(self, frame):
        """Show a live BGR camera frame on the main screen (thread-safe)."""
        try:
            self._win._camera_sig.emit(frame)
        except RuntimeError:
            pass

    def hide_camera(self):
        """Return the main screen from the camera preview to the visual panel."""
        try:
            self._win._camera_hide_sig.emit()
        except RuntimeError:
            pass

    def clear_visual(self):
        """Return the main screen to the HUD face (thread-safe)."""
        try:
            self._win._visual_clear_sig.emit()
        except RuntimeError:
            pass

    def wait_for_api_key(self):
        while not self._win._ready:
            time.sleep(0.1)

    def start_speaking(self):
        self.set_state("SPEAKING")

    def stop_speaking(self):
        if not self.muted:
            self.set_state("LISTENING")


def _visual_demo():
    """Eyeball the VisualPanel without the audio/Gemini stack:

    python ui.py            -> cube card
    python ui.py steps      -> steps card
    python ui.py ccw|180    -> cube card with that turn direction
    """
    app = QApplication.instance() or QApplication(sys.argv)
    app.setStyle("Fusion")
    win = QMainWindow()
    win.setWindowTitle("VisualPanel demo")
    win.resize(900, 700)
    panel = VisualPanel()
    win.setCentralWidget(panel)

    arg = sys.argv[1].lower() if len(sys.argv) > 1 else "cube"
    if arg == "steps":
        panel.set_card(
            {
                "kind": "steps",
                "title": "Assemble the bracket",
                "index": 1,
                "steps": [
                    {
                        "heading": "Align the two side panels",
                        "detail": "Stand both panels upright with the pre-drilled holes facing inward.",
                        "highlight": "Holes must line up before you insert any screws.",
                    },
                    {
                        "heading": "Insert the cross bar",
                        "detail": "Slide the cross bar between the panels and seat it into the top slots.",
                        "highlight": "It should click into place.",
                    },
                    {
                        "heading": "Drive the four screws",
                        "detail": "Hand-tighten all four corner screws first, then go around again firmly.",
                    },
                ],
            }
        )
    else:
        direction = {"ccw": "CCW", "180": "180"}.get(arg, "CW")
        demo_state = "wowgybwyogygybyoggrowbrgywrborwggybrbwororbwborgowryby"
        panel.set_card(
            {
                "kind": "cube",
                "index": 7,
                "total": 20,
                "face": "R",
                "direction": direction,
                "color": "green",
                "notation": {"CW": "R", "CCW": "R'", "180": "R2"}[direction],
                "where": "on your RIGHT (green)",
                "face_grid": demo_state[27:36],
                "state": demo_state,
            }
        )

    win.show()
    app.exec()


if __name__ == "__main__":
    _visual_demo()
