"use client";

import { ObjectRecognitionView, ObjectRecognitionEmpty, readObjectRecognitionContent } from "@platform/ui/templates/object-recognition";
import type { ExperienceContent } from "@/types/display";

/**
 * Renders the Object Recognition experience on a screen. Unlike Product
 * Showcase, this never fetches anything — apps/api/src/ws/gateway.ts's
 * applyMatInventoryUpdate() already resolved labels to catalogue products
 * before pushing the CONTENT_UPDATE, so templateContent carries the exact
 * items to show.
 */
export function ObjectRecognitionRenderer({ content }: { content: ExperienceContent; preview?: boolean }) {
  const config = readObjectRecognitionContent(content.templateContent);
  const items = config?.items ?? [];

  if (items.length === 0) return <ObjectRecognitionEmpty />;
  return <ObjectRecognitionView items={items} />;
}
