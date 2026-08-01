import { ScreenStage } from "../portfolio/components/screen-stage";
import { GalleryView } from "./gallery-view";
import type { GalleryContent } from "./content";

/**
 * Full-screen, chrome-less render of a Gallery experience — used by the live
 * screens app and the CMS full-screen preview. Scales the authored 1920×1080
 * layout to fit the viewport, so the px font sizes in the editor mean the same
 * thing here as they do on the wall.
 */
export function GalleryRenderer({ content }: { content?: GalleryContent }) {
  return (
    // Establish a real viewport-sized box so ScreenStage's fit-screen height has
    // something to resolve against — same reason as PortfolioRenderer.
    <div style={{ width: "100vw", height: "100vh" }}>
      <ScreenStage variant="fit-screen">
        <GalleryView content={content} />
      </ScreenStage>
    </div>
  );
}
