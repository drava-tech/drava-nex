import { PortfolioRenderer, type PortfolioContent } from "@platform/ui/templates/portfolio";
import { readLiveStreamContent } from "@platform/ui/templates/live-stream";
import { WelcomeRenderer, readWelcomeContent } from "@platform/ui/templates/welcome";
import {
  FlightSimulationRenderer,
  readFlightSimulationContent,
} from "@platform/ui/templates/flight-simulation";
import type { Content } from "@/types/display";
import { VideoRenderer } from "./VideoRenderer";
import { ImageRenderer } from "./ImageRenderer";
import { HtmlRenderer } from "./HtmlRenderer";
import { StreamRenderer } from "./StreamRenderer";
import { LiveStreamRenderer } from "./LiveStreamRenderer";
import { ProductShowcaseRenderer } from "./ProductShowcaseRenderer";
import { ObjectRecognitionRenderer } from "./ObjectRecognitionRenderer";
import { ExperienceDisplay } from "./ExperienceDisplay";

export function ContentRenderer({
  content,
  screenId,
  preview,
}: {
  content: Content;
  screenId?: string;
  preview?: boolean;
}) {
  switch (content.type) {
    case "video":
      return <VideoRenderer content={content} />;
    case "image":
      return <ImageRenderer content={content} />;
    case "html":
      return <HtmlRenderer content={content} />;
    case "stream":
      return <StreamRenderer content={content} />;
    case "experience": {
      // An experience assigned a code-defined template renders that template
      // full-screen (the authored content). Without a template, fall back to the
      // standby/demo display.
      if (content.templateKey === "portfolio") {
        const portfolio = content.templateContent?.["portfolio"] as PortfolioContent | undefined;
        return <PortfolioRenderer content={portfolio} />;
      }
      if (content.templateKey === "live-stream") {
        const ls = readLiveStreamContent(content.templateContent);
        if (ls?.streamId) {
          return <LiveStreamRenderer key={ls.streamId} streamId={ls.streamId} fit={ls.fit} label={ls.label} />;
        }
        return <ExperienceDisplay title={content.title} screenId={screenId} />;
      }
      if (content.templateKey === "product-showcase") {
        return <ProductShowcaseRenderer content={content} preview={preview} />;
      }
      if (content.templateKey === "object-recognition") {
        return <ObjectRecognitionRenderer content={content} preview={preview} />;
      }
      if (content.templateKey === "welcome") {
        const welcome = readWelcomeContent(content.templateContent);
        return <WelcomeRenderer content={welcome ?? undefined} speak={!preview} />;
      }
      if (content.templateKey === "flight-simulation") {
        const flight = readFlightSimulationContent(content.templateContent);
        // The scene fills the screen itself (camera-fitted, resolution
        // independent) — no ScreenStage, which would letterbox and rescale it.
        return <FlightSimulationRenderer content={flight} />;
      }
      return <ExperienceDisplay title={content.title} screenId={screenId} />;
    }
    default: {
      const _exhaustive = content as never;
      return (
        <div style={{ color: "#ef4444", padding: "2rem" }}>
          Unsupported content type: {(_exhaustive as Content).type}
        </div>
      );
    }
  }
}
