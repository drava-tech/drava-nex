import { Detection, StabilityEvent, VisionConfig } from "./types.js";

/**
 * Debounce layer between raw per-frame detections and emitted events. Exact
 * port of services/product-vision/src/stability.py — same state machine,
 * same field semantics, so behavior matches the native service precisely.
 *
 * IDLE --(N hits)--> DETECTED --(M misses)--> IDLE
 *            ^                       |
 *            +-----------------------+  (re-detected before M misses)
 */
export class StabilityFilter {
  private hitCount = 0;
  private missCount = 0;
  private activeLabel: string | null = null;
  private state: "IDLE" | "DETECTED" = "IDLE";
  currentDetection: Detection | null = null;

  constructor(private cfg: VisionConfig) {}

  /** Feed one frame's detection result; returns the edge event, if any. */
  update(detection: Detection | null): StabilityEvent {
    if (this.state === "IDLE") {
      if (detection && detection.label === (this.activeLabel ?? detection.label)) {
        this.activeLabel = detection.label;
        this.hitCount += 1;
        this.missCount = 0;
        if (this.hitCount >= this.cfg.stabilityFrames) {
          this.state = "DETECTED";
          this.currentDetection = detection;
          this.hitCount = 0;
          return StabilityEvent.PRODUCT_DETECTED;
        }
      } else {
        this.hitCount = 0;
        this.activeLabel = detection ? detection.label : null;
      }
      return StabilityEvent.NONE;
    }

    // DETECTED
    if (detection && detection.label === this.activeLabel) {
      this.missCount = 0;
      this.currentDetection = detection;
    } else {
      this.missCount += 1;
      if (this.missCount >= this.cfg.lostFrames) {
        this.state = "IDLE";
        this.hitCount = 0;
        this.missCount = 0;
        this.activeLabel = null;
        this.currentDetection = null;
        return StabilityEvent.PRODUCT_LOST;
      }
    }
    return StabilityEvent.NONE;
  }
}
