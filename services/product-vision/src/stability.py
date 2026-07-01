"""
stability.py — Detection stability filter for the Product Vision service.

Prevents flickering events caused by single-frame false positives or brief
occlusions. A product is not reported until it has been consistently detected
for N consecutive frames (stability_frames), and not reported as lost until it
has been consistently absent for M consecutive frames (lost_frames).

State machine:
    IDLE  ──(N hits)──►  DETECTED  ──(M misses)──►  IDLE
               ▲                        │
               └────────────────────────┘  (re-detected before M misses)

Usage:
    filter = StabilityFilter(config)
    event = filter.update(detection_or_None)
    if event == StabilityEvent.PRODUCT_DETECTED:
        ...
    elif event == StabilityEvent.PRODUCT_LOST:
        ...
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Optional

from config import Config
from detector import Detection


class StabilityEvent(Enum):
    NONE = auto()
    PRODUCT_DETECTED = auto()
    PRODUCT_LOST = auto()


@dataclass
class StabilityFilter:
    """
    Debounce layer between raw per-frame detections and WebSocket events.

    Ceiling notes (ponytail: O(1) state, no history retained beyond counters).
    """
    cfg: Config
    _hit_count: int = field(default=0, init=False)
    _miss_count: int = field(default=0, init=False)
    _active_label: Optional[str] = field(default=None, init=False)
    _state: str = field(default="IDLE", init=False)  # "IDLE" | "DETECTED"
    current_detection: Optional[Detection] = field(default=None, init=False)

    def update(self, detection: Optional[Detection]) -> StabilityEvent:
        """
        Feed one frame's detection result; returns the edge event, if any.

        Call once per camera frame.
        """
        if self._state == "IDLE":
            if detection and detection.label == (self._active_label or detection.label):
                self._active_label = detection.label
                self._hit_count += 1
                self._miss_count = 0
                if self._hit_count >= self.cfg.stability_frames:
                    self._state = "DETECTED"
                    self.current_detection = detection
                    self._hit_count = 0
                    return StabilityEvent.PRODUCT_DETECTED
            else:
                # Different label or nothing — reset hit streak
                self._hit_count = 0
                self._active_label = detection.label if detection else None
            return StabilityEvent.NONE

        else:  # DETECTED
            if detection and detection.label == self._active_label:
                self._miss_count = 0
                self.current_detection = detection
            else:
                self._miss_count += 1
                if self._miss_count >= self.cfg.lost_frames:
                    self._state = "IDLE"
                    self._hit_count = 0
                    self._miss_count = 0
                    lost_label = self._active_label
                    self._active_label = None
                    self.current_detection = None
                    return StabilityEvent.PRODUCT_LOST
            return StabilityEvent.NONE
