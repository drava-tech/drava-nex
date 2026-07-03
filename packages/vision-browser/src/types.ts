/** A single detection result from one inference pass — mirrors detector.py's Detection. */
export interface Detection {
  label: string;
  confidence: number; // 0-1
}

export enum StabilityEvent {
  NONE,
  PRODUCT_DETECTED,
  PRODUCT_LOST,
}

/** Mirrors config.py's VISION_* fields relevant to browser-side detection. */
export interface VisionConfig {
  confidenceThreshold: number;
  stabilityFrames: number;
  lostFrames: number;
}
