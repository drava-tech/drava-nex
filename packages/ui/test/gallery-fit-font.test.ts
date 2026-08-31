import { describe, it, expect } from "vitest";
import { largestFitting } from "../src/templates/gallery/gallery-view";

// The gallery description shrinks itself to whatever height the title, pager and
// link rows leave behind. The measuring is the browser's job; the search over
// sizes is ours, and an off-by-one here is either a clipped paragraph or type a
// step smaller than it needed to be.

const upTo = (limit: number) => (px: number) => px <= limit;

describe("largestFitting", () => {
  it("finds the largest size that fits", () => {
    expect(largestFitting(11, 20, upTo(16))).toBe(16);
  });

  it("keeps the authored size as the ceiling when everything fits", () => {
    expect(largestFitting(11, 20, () => true)).toBe(20);
  });

  it("falls back to the floor when nothing fits", () => {
    expect(largestFitting(11, 20, () => false)).toBe(11);
  });

  it("handles the boundaries of the range", () => {
    expect(largestFitting(11, 20, upTo(11))).toBe(11);
    expect(largestFitting(11, 20, upTo(20))).toBe(20);
    expect(largestFitting(11, 20, upTo(19))).toBe(19);
    expect(largestFitting(11, 20, upTo(12))).toBe(12);
  });

  it("agrees with a linear scan at every threshold", () => {
    for (let limit = 5; limit <= 30; limit++) {
      const expected = limit < 11 ? 11 : Math.min(limit, 20);
      expect(largestFitting(11, 20, upTo(limit))).toBe(expected);
    }
  });

  it("probes each size at most once, and few of them", () => {
    const seen: number[] = [];
    largestFitting(11, 64, (px) => {
      seen.push(px);
      return px <= 40;
    });
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeLessThanOrEqual(7);
  });
});
