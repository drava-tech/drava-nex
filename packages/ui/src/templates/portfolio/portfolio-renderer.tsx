import { ScreenStage } from "./components/screen-stage";
import { PortfolioLiveApp } from "./portfolio-live-app";
import type { PortfolioContent } from "./content";

/**
 * Full-screen, chrome-less render of a Portfolio experience — used by the live
 * screens app and the CMS full-screen preview. Scales the authored 1920×1080
 * view to fit the viewport. Navigation (overview → vertical → slideshow) is
 * state-driven and WS-synced via PortfolioLiveApp.
 */
export function PortfolioRenderer({ content }: { content?: PortfolioContent }) {
  return (
    // Establish a real viewport-sized box so ScreenStage's `h-full` (fit-screen)
    // has a height to resolve against — without this it collapses to 0 and the
    // scaled content is hidden, leaving only ScreenStage's black background.
    <div style={{ width: "100vw", height: "100vh" }}>
      <ScreenStage variant="fit-screen">
        <PortfolioLiveApp content={content} />
      </ScreenStage>
    </div>
  );
}
