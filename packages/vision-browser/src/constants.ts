import type { VisionConfig } from "./types.js";

export const VISION_DEFAULTS = {
  confidenceThreshold: 0.4,
  // Balance point between false-positive suppression and real-detection
  // recall — the model has no true negative training data (see
  // services/product-vision/README.md), so its confidence signal is noisy
  // in both directions. Retrain is the actual fix; this is a tuning dial.
  stabilityFrames: 3,
  lostFrames: 10,
  // Closed-loop capture (see useServerDetection.ts) paces itself off the
  // round trip; this is only a floor between attempts, not a fixed cadence.
  captureIntervalMs: 10,
  maxSide: 640,
  quality: 0.75,
};

export const VISION_CONFIG: VisionConfig = {
  confidenceThreshold: VISION_DEFAULTS.confidenceThreshold,
  stabilityFrames: VISION_DEFAULTS.stabilityFrames,
  lostFrames: VISION_DEFAULTS.lostFrames,
};
