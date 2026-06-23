import { ScreenStage } from "./screen-stage";
import { OverviewView } from "./overview";
import type { PortfolioContent } from "./content";

/**
 * Full-screen, chrome-less render of a Portfolio experience — used by the live
 * screens app and the CMS full-screen preview. Scales the authored 1920×1080
 * view to fit the viewport. One view today (Overview).
 */
export function PortfolioRenderer({ content }: { content?: PortfolioContent }) {
  return (
    // Establish a real viewport-sized box so ScreenStage's `h-full` (fit-screen)
    // has a height to resolve against — without this it collapses to 0 and the
    // scaled content is hidden, leaving only ScreenStage's black background.
    <div style={{ width: "100vw", height: "100vh" }}>
      <ScreenStage variant="fit-screen">
        <OverviewView content={content} />
      </ScreenStage>
    </div>
  );
}
