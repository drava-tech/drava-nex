"use client";

import { useEffect, useState } from "react";
import { ScreenStage } from "@platform/ui/templates/portfolio";
import {
  ObjectRecognitionView,
  ObjectRecognitionEmpty,
  type ObjectRecognitionContent,
} from "@platform/ui/templates/object-recognition";
import { listProductsForPickerAction } from "@/actions/product-actions";

/**
 * Object Recognition has no authored content — the real screen always shows
 * whatever apps/api/src/ws/gateway.ts's applyMatInventoryUpdate() last pushed
 * live from the mat camera. There's no productId stored on the experience to
 * look up, so instead this fetches a few real ACTIVE catalogue products that
 * have a detectionLabel configured (the ones this feature can actually
 * recognize) and previews the layout with them — real ids/names from your
 * catalogue, not fabricated placeholder data. Never reflects a live mat.
 */
export function ObjectRecognitionPreview({
  content,
  variant = "fit-width",
}: {
  content: ObjectRecognitionContent;
  variant?: "fit-width" | "fit-screen";
}) {
  const [sampleItems, setSampleItems] = useState<
    ObjectRecognitionContent["items"] | null
  >(null);

  useEffect(() => {
    if (content.items.length > 0) return; // already have real (live-pushed) content
    let active = true;
    listProductsForPickerAction().then((res) => {
      if (!active) return;
      const detectable = (res.success ? res.data?.items ?? [] : [])
        .filter((p) => p.status === "ACTIVE" && p.detectionLabel)
        .slice(0, 3)
        .map((p) => ({
          productId: p.id,
          name: p.name,
          detectionLabel: p.detectionLabel!,
          count: 1,
        }));
      setSampleItems(detectable);
    });
    return () => {
      active = false;
    };
  }, [content.items]);

  const items = content.items.length > 0 ? content.items : sampleItems;

  return (
    <ScreenStage variant={variant}>
      <div style={{ width: 1920, height: 1080 }}>
        {items && items.length > 0 ? <ObjectRecognitionView items={items} /> : <ObjectRecognitionEmpty />}
      </div>
    </ScreenStage>
  );
}
