import type { Experience } from "@platform/db";
import { ScreenStage } from "@platform/ui/templates/portfolio";
import { WelcomeRenderer, readWelcomeContent } from "@platform/ui/templates/welcome";

/**
 * Welcome template — a full-screen greeting (headline/subtitle/video, edited
 * via editor-workspace.tsx). Both edit and preview modes render the same
 * thing, scaled to fit.
 */
export function WelcomeLayout({ experience }: { experience: Experience; subpath: string[]; mode?: "edit" | "preview" }) {
  const content = readWelcomeContent(experience.templateContent) ?? undefined;
  return (
    <ScreenStage variant="fit-screen">
      <WelcomeRenderer content={content} preview />
    </ScreenStage>
  );
}
