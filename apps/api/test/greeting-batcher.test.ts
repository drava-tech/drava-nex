import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Batcher } from "../src/services/greeting/batcher.js";

describe("Batcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("the first add opens a window; everything inside it flushes together, once", () => {
    const flushed: string[][] = [];
    const b = new Batcher<string>(3000, (items) => void flushed.push(items));

    b.add("Priya");
    vi.advanceTimersByTime(1000);
    b.add("Arjun");
    vi.advanceTimersByTime(1000);
    b.add("Meera");
    expect(flushed).toEqual([]);

    vi.advanceTimersByTime(1000); // 3000 ms after the FIRST add
    expect(flushed).toEqual([["Priya", "Arjun", "Meera"]]);
  });

  it("a join does NOT extend the window (a steady trickle can't postpone a greeting forever)", () => {
    const flushed: string[][] = [];
    const b = new Batcher<string>(3000, (items) => void flushed.push(items));

    b.add("a");
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(500);
      b.add(`late${i}`);
    }
    vi.advanceTimersByTime(500); // t=3000
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toHaveLength(6);
  });

  it("someone after the flush starts a new batch", () => {
    const flushed: string[][] = [];
    const b = new Batcher<string>(3000, (items) => void flushed.push(items));

    b.add("Priya");
    vi.advanceTimersByTime(3000);
    b.add("Arjun");
    expect(flushed).toEqual([["Priya"]]);
    vi.advanceTimersByTime(3000);
    expect(flushed).toEqual([["Priya"], ["Arjun"]]);
  });

  it("window 0 disables grouping: each item is flushed alone, immediately", () => {
    const flushed: string[][] = [];
    const b = new Batcher<string>(0, (items) => void flushed.push(items));

    b.add("Priya");
    b.add("Arjun");
    expect(flushed).toEqual([["Priya"], ["Arjun"]]);
  });
});
