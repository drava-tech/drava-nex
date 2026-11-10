"use client";

import { useCallback, useEffect, useRef } from "react";
import { useReplayableWindowEvent } from "../../lib/replayable-window-event";
import {
  DATA_ART_APPLY_MESSAGE,
  DATA_ART_READY_MESSAGE,
  DATA_ART_STATE_MESSAGE,
  DATA_ART_VIEW_COMMAND,
  DATA_ART_VIEW_EVENT,
  DRAVA_MOSAIC_URL,
  readDataArtView,
  type DataArtView,
} from "./content";

/** What a cleared view (RESET_VIEW) means: back to the landing page, picks kept. */
const CLOSED: DataArtView = { data: null, art: null, open: false, clock: null };

/**
 * Renders the Drava Mosaic full-bleed — the standalone app, unchanged. Used
 * by the CMS preview/editor and the live display alike.
 *
 * The studio is its own multi-page app (three WebGL/video pages built by
 * packages/drava-mosaic), so it runs in a same-origin iframe rather than
 * being mounted into React — the same way the studio itself hosts its Flight
 * Garden and World Clock. That keeps every page's globals, listeners and WebGL
 * contexts isolated, and unmounting the iframe releases all of them at once.
 *
 * This component is also the studio's sync bridge. The studio posts its
 * landing-page choices (data source, art, Generate/back) up to here; they go out
 * on the "screen-control" bus so every other client of the screen (the wall, a
 * CMS mirror) receives them, and whatever arrives from those clients is posted
 * back down into the iframe. See DATA_ART_VIEW_COMMAND in ./content.
 */
export function DravaMosaicRenderer({ src = DRAVA_MOSAIC_URL }: { src?: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  /** The newest view, so a studio that is still loading catches up when it is ready. */
  const latest = useRef<DataArtView | null>(null);

  const postToStudio = useCallback(() => {
    if (!latest.current) return;
    frameRef.current?.contentWindow?.postMessage(
      { type: DATA_ART_APPLY_MESSAGE, state: latest.current },
      window.location.origin
    );
  }, []);

  // From the screen: another client changed the view (or the gateway replayed
  // the remembered one to us). Undefined = RESET_VIEW.
  useReplayableWindowEvent<unknown>(DATA_ART_VIEW_EVENT, (detail) => {
    latest.current = readDataArtView(detail) ?? CLOSED;
    postToStudio();
  });

  // From the studio: the operator chose something here, or the page came up.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.source !== frameRef.current?.contentWindow) return;
      const data = e.data as { type?: unknown; state?: unknown } | null;
      if (data?.type === DATA_ART_READY_MESSAGE) {
        postToStudio();
      } else if (data?.type === DATA_ART_STATE_MESSAGE) {
        const view = readDataArtView(data.state);
        if (!view) return;
        latest.current = view;
        window.dispatchEvent(
          new CustomEvent("screen-control", {
            detail: { command: DATA_ART_VIEW_COMMAND, value: view },
          })
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postToStudio]);

  return (
    <iframe
      ref={frameRef}
      src={src}
      title="Drava Mosaic"
      // autoplay: the art is muted video, but some players gate even that.
      allow="autoplay; fullscreen"
      allowFullScreen
      onLoad={postToStudio}
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        border: 0,
        background: "#05070a",
      }}
    />
  );
}
