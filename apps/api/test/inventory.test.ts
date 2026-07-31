import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB layer so this stays a pure unit test (no Postgres connection).
const { getProductsByDetectionLabels } = vi.hoisted(() => ({
  getProductsByDetectionLabels: vi.fn(),
}));
vi.mock("@platform/db", () => ({ getProductsByDetectionLabels }));

import { resolveMatInventory } from "../src/services/inventory.js";

describe("resolveMatInventory", () => {
  beforeEach(() => {
    getProductsByDetectionLabels.mockReset();
  });

  it("rejects a malformed items payload without hitting the DB", async () => {
    const res = await resolveMatInventory({
      cameraId: "cam-mat",
      items: [{ detectionLabel: "Bad Label", count: 1 }],
    });
    expect(res.resolved).toBe(false);
    expect(res.reason).toBe("INVALID_EVENT");
    expect(getProductsByDetectionLabels).not.toHaveBeenCalled();
  });

  it("treats an empty mat as a valid, resolved, empty result", async () => {
    const res = await resolveMatInventory({ cameraId: "cam-mat", items: [] });
    expect(res.resolved).toBe(true);
    expect(res.items).toEqual([]);
    expect(getProductsByDetectionLabels).not.toHaveBeenCalled();
  });

  it("batch-resolves multiple labels in one DB call", async () => {
    getProductsByDetectionLabels.mockResolvedValue([
      { productId: "p1", name: "Journal", detectionLabel: "a6_raw_press_lock_journal", status: "ACTIVE" },
      { productId: "p2", name: "Pen", detectionLabel: "pen", status: "ACTIVE" },
    ]);

    const res = await resolveMatInventory({
      cameraId: "cam-mat",
      items: [
        { detectionLabel: "a6_raw_press_lock_journal", count: 1 },
        { detectionLabel: "pen", count: 1 },
      ],
    });

    expect(res.resolved).toBe(true);
    expect(getProductsByDetectionLabels).toHaveBeenCalledTimes(1);
    expect(getProductsByDetectionLabels).toHaveBeenCalledWith(
      expect.arrayContaining(["a6_raw_press_lock_journal", "pen"])
    );
    expect(res.items).toEqual(
      expect.arrayContaining([
        { productId: "p1", name: "Journal", detectionLabel: "a6_raw_press_lock_journal", count: 1 },
        { productId: "p2", name: "Pen", detectionLabel: "pen", count: 1 },
      ])
    );
  });

  it("drops labels with no matching ACTIVE product", async () => {
    getProductsByDetectionLabels.mockResolvedValue([
      { productId: "p1", name: "Journal", detectionLabel: "a6_raw_press_lock_journal", status: "ACTIVE" },
    ]);

    const res = await resolveMatInventory({
      cameraId: "cam-mat",
      items: [
        { detectionLabel: "a6_raw_press_lock_journal", count: 1 },
        { detectionLabel: "card_holder", count: 1 }, // no ACTIVE product with this label
      ],
    });

    expect(res.resolved).toBe(true);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.detectionLabel).toBe("a6_raw_press_lock_journal");
  });
});
