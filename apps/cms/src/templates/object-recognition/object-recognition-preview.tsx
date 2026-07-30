"use client";

import type { MatInventoryDisplayItem } from "@platform/types";
import { ScreenStage } from "@platform/ui/templates/portfolio";
import { ObjectRecognitionView, type ObjectRecognitionContent } from "@platform/ui/templates/object-recognition";

// Object Recognition has no authored content — the real screen always shows
// whatever apps/api/src/ws/gateway.ts's applyMatInventoryUpdate() last pushed
// live from the mat camera. There's nothing to fetch here (no productId to
// look up), so the CMS editor/preview routes show a fixed sample instead, just
// so you can see the layout — it never reflects a live mat.
const SAMPLE_ITEMS: MatInventoryDisplayItem[] = [
  { productId: "sample-1", name: "A6 Raw Press Lock Journal", detectionLabel: "a6_raw_press_lock_journal", count: 1 },
  { productId: "sample-2", name: "Pen", detectionLabel: "pen", count: 1 },
  { productId: "sample-3", name: "Card Holder", detectionLabel: "card_holder", count: 1 },
];

/**
 * Sample-data preview of the Object Recognition template for the CMS editor/
 * preview routes. The live screen never uses this component — see
 * apps/cms/src/app/display/_components/ObjectRecognitionRenderer.tsx for that.
 */
export function ObjectRecognitionPreview({
  content,
  variant = "fit-width",
}: {
  content: ObjectRecognitionContent;
  variant?: "fit-width" | "fit-screen";
}) {
  const items = content.items.length > 0 ? content.items : SAMPLE_ITEMS;

  return (
    <ScreenStage variant={variant}>
      <div style={{ width: 1920, height: 1080 }}>
        <ObjectRecognitionView items={items} />
      </div>
    </ScreenStage>
  );
}
