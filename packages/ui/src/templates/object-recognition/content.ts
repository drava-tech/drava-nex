// Content shape for the Object Recognition template. Stored on the experience
// as experience.templateContent["object-recognition"]. Unlike Product
// Showcase, this content is NOT authored in the CMS — it's overwritten live by
// apps/api/src/ws/gateway.ts's applyMatInventoryUpdate() every time the mat's
// contents change. The screen always shows whatever's physically on the mat
// right now; there's nothing to configure beyond which camera feeds it
// (set via CAMERA_SCREEN_MAP, not stored here).

import type { MatInventoryDisplayItem } from "@platform/types";

export interface ObjectRecognitionContent {
  items: MatInventoryDisplayItem[];
}

export const DEFAULT_OBJECT_RECOGNITION_CONTENT: ObjectRecognitionContent = {
  items: [],
};

/** Reads the object-recognition content slice off an experience row, or null. */
export function readObjectRecognitionContent(
  templateContent: Record<string, unknown> | null | undefined
): ObjectRecognitionContent | null {
  const slice = templateContent?.["object-recognition"];
  if (!slice || typeof slice !== "object") return null;
  const items = (slice as Partial<ObjectRecognitionContent>).items;
  return { items: Array.isArray(items) ? items : [] };
}
