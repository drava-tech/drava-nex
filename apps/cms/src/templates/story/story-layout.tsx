import type { Experience } from "@platform/db";
import { StoryPlayer, readStoryContent, DEFAULT_STORY_CONTENT } from "@platform/ui/templates/story";
import "../canvas/fonts";

/** Story template — the preview tab plays it exactly as a touchscreen does. */
export function StoryLayout({ experience }: { experience: Experience; subpath: string[]; mode?: "edit" | "preview" }) {
  const content = readStoryContent(experience.templateContent) ?? DEFAULT_STORY_CONTENT;
  return <StoryPlayer content={content} />;
}
