import type { Experience } from "@platform/db";
import { CanvasRenderer, readCanvasContent, DEFAULT_CANVAS_CONTENT } from "@platform/ui/templates/canvas";
import "./fonts";

/**
 * Design template — a free-form layout from the Frames editor. The preview
 * tab plays it exactly as a screen does (scaled to fit, pages cycling).
 */
export function CanvasLayout({ experience }: { experience: Experience; subpath: string[]; mode?: "edit" | "preview" }) {
  const content = readCanvasContent(experience.templateContent) ?? DEFAULT_CANVAS_CONTENT;
  return <CanvasRenderer content={content} />;
}
