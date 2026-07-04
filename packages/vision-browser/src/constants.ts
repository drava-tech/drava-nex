import type { VisionConfig } from "./types.js";

export const VISION_DEFAULTS = {
  confidenceThreshold: 0.4,
  stabilityFrames: 3,
  lostFrames: 10,
  captureIntervalMs: 100,
  maxSide: 640,
  quality: 0.75,
  holdProduct: true,
};

export const VISION_CONFIG: VisionConfig = {
  confidenceThreshold: VISION_DEFAULTS.confidenceThreshold,
  stabilityFrames: VISION_DEFAULTS.stabilityFrames,
  lostFrames: VISION_DEFAULTS.lostFrames,
};
