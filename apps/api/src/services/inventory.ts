import { getProductsByDetectionLabels } from "@platform/db";
import { inventoryUpdateEventSchema, type MatInventoryDisplayItem } from "@platform/types";

/**
 * Mat-inventory resolver — the multi-item counterpart to detection.ts's
 * resolveDetectedProduct. Validates an INVENTORY_UPDATE event (full current
 * mat contents, not a single best guess) and resolves every label to an
 * ACTIVE catalogue product in one batch query.
 */

export type InventoryResolutionReason = "INVALID_EVENT";

export interface InventoryResolution {
  resolved: boolean;
  items: MatInventoryDisplayItem[];
  reason?: InventoryResolutionReason;
}

export interface InventoryInput {
  cameraId: string;
  items: unknown;
  detectedAt?: string;
}

export async function resolveMatInventory(input: InventoryInput): Promise<InventoryResolution> {
  const parsed = inventoryUpdateEventSchema.safeParse({
    type: "INVENTORY_UPDATE",
    cameraId: input.cameraId,
    items: input.items,
    detectedAt: input.detectedAt ?? new Date().toISOString(),
  });
  if (!parsed.success) return { resolved: false, items: [], reason: "INVALID_EVENT" };

  if (parsed.data.items.length === 0) {
    // A genuinely empty mat is a valid state (not an error) — the caller
    // decides whether to clear the current display or leave it as-is.
    return { resolved: true, items: [] };
  }

  const countByLabel = new Map(parsed.data.items.map((item) => [item.detectionLabel, item.count]));
  const products = await getProductsByDetectionLabels([...countByLabel.keys()]);

  const items: MatInventoryDisplayItem[] = products.map((p) => ({
    productId: p.productId,
    name: p.name,
    detectionLabel: p.detectionLabel,
    count: countByLabel.get(p.detectionLabel) ?? 1,
  }));

  return { resolved: true, items };
}
