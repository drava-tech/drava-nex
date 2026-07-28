import { describe, it, expect } from "vitest";
import { StabilityFilter } from "../src/stability.js";
import { StabilityEvent, type VisionConfig } from "../src/types.js";
import { VISION_CONFIG, VISION_DEFAULTS } from "../src/constants.js";

/**
 * The debounce that stands between raw per-frame YOLO output and a screen
 * takeover. A single noisy frame reaching PRODUCT_DETECTED would flip a display
 * in front of visitors, so the hit/miss counting is pinned down here.
 */

const cfg = (stabilityFrames: number, lostFrames: number): VisionConfig => ({
  confidenceThreshold: 0.4,
  stabilityFrames,
  lostFrames,
});

const hit = (label = "coster", confidence = 0.9) => ({ label, confidence });

describe("StabilityFilter — detection", () => {
  it("requires N consecutive hits before emitting PRODUCT_DETECTED", () => {
    const filter = new StabilityFilter(cfg(3, 10));

    expect(filter.update(hit())).toBe(StabilityEvent.NONE);
    expect(filter.update(hit())).toBe(StabilityEvent.NONE);
    expect(filter.update(hit())).toBe(StabilityEvent.PRODUCT_DETECTED);
    expect(filter.currentDetection).toEqual(hit());
  });

  it("a single noisy frame never triggers a takeover", () => {
    const filter = new StabilityFilter(cfg(3, 10));

    expect(filter.update(hit("coster", 0.99))).toBe(StabilityEvent.NONE);
    expect(filter.update(null)).toBe(StabilityEvent.NONE);
    expect(filter.update(hit("coster", 0.99))).toBe(StabilityEvent.NONE);
    expect(filter.update(null)).toBe(StabilityEvent.NONE);

    expect(filter.currentDetection).toBeNull();
  });

  it("a miss resets the hit streak", () => {
    const filter = new StabilityFilter(cfg(3, 10));

    filter.update(hit());
    filter.update(hit());
    expect(filter.update(null)).toBe(StabilityEvent.NONE);

    // Streak restarted — two more hits must NOT be enough.
    expect(filter.update(hit())).toBe(StabilityEvent.NONE);
    expect(filter.update(hit())).toBe(StabilityEvent.NONE);
    expect(filter.update(hit())).toBe(StabilityEvent.PRODUCT_DETECTED);
  });

  it("switching label mid-streak restarts the count for the new label", () => {
    const filter = new StabilityFilter(cfg(3, 10));

    filter.update(hit("coster"));
    filter.update(hit("coster"));
    // The switching frame zeroes the streak and only *arms* the new label — it
    // does not count as its first hit, so a full stabilityFrames run follows.
    expect(filter.update(hit("smart_glasses"))).toBe(StabilityEvent.NONE);

    expect(filter.update(hit("smart_glasses"))).toBe(StabilityEvent.NONE);
    expect(filter.update(hit("smart_glasses"))).toBe(StabilityEvent.NONE);
    expect(filter.update(hit("smart_glasses"))).toBe(StabilityEvent.PRODUCT_DETECTED);
    expect(filter.currentDetection?.label).toBe("smart_glasses");
  });

  it("emits PRODUCT_DETECTED exactly once for a sustained detection", () => {
    const filter = new StabilityFilter(cfg(2, 10));

    filter.update(hit());
    expect(filter.update(hit())).toBe(StabilityEvent.PRODUCT_DETECTED);
    for (let i = 0; i < 5; i++) {
      expect(filter.update(hit())).toBe(StabilityEvent.NONE);
    }
  });
});

describe("StabilityFilter — loss", () => {
  function detected(stabilityFrames = 2, lostFrames = 3) {
    const filter = new StabilityFilter(cfg(stabilityFrames, lostFrames));
    for (let i = 0; i < stabilityFrames; i++) filter.update(hit());
    return filter;
  }

  it("emits PRODUCT_LOST only after M consecutive misses", () => {
    const filter = detected(2, 3);

    expect(filter.update(null)).toBe(StabilityEvent.NONE);
    expect(filter.update(null)).toBe(StabilityEvent.NONE);
    expect(filter.update(null)).toBe(StabilityEvent.PRODUCT_LOST);
    expect(filter.currentDetection).toBeNull();
  });

  it("a re-detection before the miss budget runs out cancels the loss", () => {
    const filter = detected(2, 3);

    filter.update(null);
    filter.update(null);
    expect(filter.update(hit())).toBe(StabilityEvent.NONE);

    // Miss counter reset — three more misses are needed again.
    expect(filter.update(null)).toBe(StabilityEvent.NONE);
    expect(filter.update(null)).toBe(StabilityEvent.NONE);
    expect(filter.update(null)).toBe(StabilityEvent.PRODUCT_LOST);
  });

  it("a different label counts as a miss for the held label", () => {
    const filter = detected(2, 2);

    expect(filter.update(hit("smart_glasses"))).toBe(StabilityEvent.NONE);
    expect(filter.update(hit("smart_glasses"))).toBe(StabilityEvent.PRODUCT_LOST);
  });

  it("keeps reporting the latest box while the product stays in frame", () => {
    const filter = detected(2, 3);
    filter.update(hit("coster", 0.71));
    expect(filter.currentDetection).toEqual({ label: "coster", confidence: 0.71 });
  });

  it("can re-detect after a loss", () => {
    const filter = detected(2, 2);
    filter.update(null);
    expect(filter.update(null)).toBe(StabilityEvent.PRODUCT_LOST);

    filter.update(hit());
    expect(filter.update(hit())).toBe(StabilityEvent.PRODUCT_DETECTED);
  });
});

describe("shipped defaults", () => {
  it("VISION_CONFIG debounces by more than one frame in both directions", () => {
    expect(VISION_CONFIG.stabilityFrames).toBeGreaterThan(1);
    expect(VISION_CONFIG.lostFrames).toBeGreaterThan(1);
  });

  it("the default config takes several frames to trigger a takeover", () => {
    const filter = new StabilityFilter(VISION_CONFIG);
    let events = 0;
    for (let i = 0; i < VISION_CONFIG.stabilityFrames - 1; i++) {
      if (filter.update(hit()) !== StabilityEvent.NONE) events++;
    }
    expect(events).toBe(0);
    expect(filter.update(hit())).toBe(StabilityEvent.PRODUCT_DETECTED);
  });

  it("the frame capture ceiling matches the server's 640px inference size", () => {
    expect(VISION_DEFAULTS.maxSide).toBe(640);
  });
});
