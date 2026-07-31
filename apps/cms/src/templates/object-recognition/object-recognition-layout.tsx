"use client";

import type { Experience } from "@platform/db";
import {
  readObjectRecognitionContent,
  DEFAULT_OBJECT_RECOGNITION_CONTENT,
} from "@platform/ui/templates/object-recognition";
import { ObjectRecognitionPreview } from "./object-recognition-preview";

/**
 * Object Recognition template surface for the CMS edit/preview routes.
 * There's no Workspace (nothing to author — content is pushed live by the mat
 * camera), so this Layout is the whole template surface: a sample-data
 * preview so you can see the visual layout.
 */
export function ObjectRecognitionLayout({
  experience,
  mode = "edit",
}: {
  experience: Experience;
  subpath: string[];
  mode?: "edit" | "preview";
}) {
  const content =
    readObjectRecognitionContent(experience.templateContent) ?? DEFAULT_OBJECT_RECOGNITION_CONTENT;

  if (mode === "preview") {
    return <ObjectRecognitionPreview content={content} variant="fit-screen" />;
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-violet-500">
        Object Recognition
      </span>
      <ObjectRecognitionPreview content={content} variant="fit-width" />
    </div>
  );
}
