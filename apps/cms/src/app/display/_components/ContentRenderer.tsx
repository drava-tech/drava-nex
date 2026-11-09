"use client";

import { useEffect, useRef } from "react";
import { PortfolioRenderer, type PortfolioContent } from "@platform/ui/templates/portfolio";
import { readLiveStreamContent } from "@platform/ui/templates/live-stream";
import { WelcomeRenderer, readWelcomeContent } from "@platform/ui/templates/welcome";
import {
  FlightSimulationRenderer,
  readFlightSimulationContent,
} from "@platform/ui/templates/flight-simulation";
import { GalleryRenderer, readGalleryContent } from "@platform/ui/templates/gallery";
import { DravaMosaicRenderer } from "@platform/ui/templates/drava-mosaic";
import type { Content } from "@/types/display";
import { VideoRenderer } from "./VideoRenderer";
import { ImageRenderer } from "./ImageRenderer";
import { HtmlRenderer } from "./HtmlRenderer";
import { StreamRenderer } from "./StreamRenderer";
import { LiveStreamRenderer } from "./LiveStreamRenderer";
import { ProductShowcaseRenderer } from "./ProductShowcaseRenderer";
import { ObjectRecognitionRenderer } from "./ObjectRecognitionRenderer";
import { ExperienceDisplay } from "./ExperienceDisplay";

/**
 * Content types that report readiness themselves, from a real first-frame or
 * document-load signal. Everything else paints as soon as React commits it, so
 * ContentRenderer reports on its behalf — which keeps the push transition from
 * having to wait out its ready timeout on eight templates that would never
 * signal, without threading a prop through every one of them.
 */
function ownsReadySignal(content: Content): boolean {
  if (content.type === "video" || content.type === "image") return true;
  if (content.type === "html" || content.type === "stream") return true;
  return content.type === "experience" && content.templateKey === "welcome";
}

export function ContentRenderer({
  content,
  screenId,
  preview,
  staged,
  outgoing,
  onReady,
}: {
  content: Content;
  screenId?: string;
  preview?: boolean;
  /**
   * Mounted but not yet on the panel — the display parks incoming content below
   * the bottom edge and pushes it up once it can paint. Defer anything a viewer
   * would hear or see begin: playback, narration, an autoplaying intro.
   */
  staged?: boolean;
  /**
   * Sliding away and about to unmount: ignore every global command, emit
   * nothing on the wire, render no operator chrome. While two layers are
   * mounted the gateway attributes SET_* to the content it believes is current,
   * which is already the incoming one.
   */
  outgoing?: boolean;
  /** Ready to paint. The push transition holds its animation until this fires. */
  onReady?: () => void;
}) {
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const selfReports = ownsReadySignal(content);

  useEffect(() => {
    // flight-simulation is the notable member of this group: it dynamic-imports
    // a three.js engine and so lands a beat before its canvas appears. That is
    // its behaviour today too, and there is no cheap first-frame signal for it.
    if (!selfReports) onReadyRef.current?.();
  }, [selfReports]);

  switch (content.type) {
    case "video":
      return (
        <VideoRenderer
          content={content}
          preview={preview}
          staged={staged}
          outgoing={outgoing}
          onReady={onReady}
        />
      );
    case "image":
      return <ImageRenderer content={content} onReady={onReady} />;
    case "html":
      return (
        <HtmlRenderer content={content} preview={preview} outgoing={outgoing} onReady={onReady} />
      );
    case "stream":
      return (
        <StreamRenderer content={content} preview={preview} outgoing={outgoing} onReady={onReady} />
      );
    case "experience": {
      // An experience assigned a code-defined template renders that template
      // full-screen (the authored content). Without a template, fall back to the
      // standby/demo display.
      if (content.templateKey === "portfolio") {
        const portfolio = content.templateContent?.["portfolio"] as PortfolioContent | undefined;
        return <PortfolioRenderer content={portfolio} preview={preview} />;
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
        return (
          <WelcomeRenderer
            content={welcome ?? undefined}
            speak={!preview}
            preview={preview}
            staged={staged}
            onReady={onReady}
          />
        );
      }
      if (content.templateKey === "flight-simulation") {
        const flight = readFlightSimulationContent(content.templateContent);
        // The scene fills the screen itself (camera-fitted, resolution
        // independent) — no ScreenStage, which would letterbox and rescale it.
        return <FlightSimulationRenderer content={flight} />;
      }
      if (content.templateKey === "gallery") {
        const gallery = readGalleryContent(content.templateContent);
        return <GalleryRenderer content={gallery ?? undefined} />;
      }
      if (content.templateKey === "drava-mosaic") {
        // Full-bleed like Flight Simulation: the studio's pages size their own
        // WebGL canvases to the viewport, so no ScreenStage rescaling.
        return <DravaMosaicRenderer />;
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
