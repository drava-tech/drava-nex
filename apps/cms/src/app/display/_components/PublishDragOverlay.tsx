"use client";

import { useEffect, useRef, useState } from "react";
import type {
  PublishDragEndPayload,
  PublishDragProgressPayload,
  PublishDragStartPayload,
} from "@/lib/publish-drag-protocol";

/** Safety net: if the real CONTENT_UPDATE never arrives (e.g. the publish call failed), don't leave the panel stuck covering the screen forever. */
const MAX_HOLD_MS = 5_000;

interface PublishDragOverlayProps {
  /** The id of whatever content is actually live right now — used to know when the real CONTENT_UPDATE for a committed drag has landed, so the held panel can lift. */
  activeContentId: string;
}

/**
 * Mirrors the CMS operator's swipe-up gesture in real time: as PUBLISH_DRAG_*
 * commands arrive (dispatched as window events by LiveScreenPlayer's
 * handleCommand), a full-bleed panel showing the dragged card's own thumbnail
 * rises off the bottom of the screen by the same proportion the operator has
 * dragged — pinned live, not a replay after the fact. Rendered as a sibling
 * of the normal .screen-content-fade content div (never remounted by a real
 * content swap), same placement pattern as WhiteboardScreenOverlay.
 *
 * `transform` is mutated directly on the DOM node (never through React state)
 * so progress updates apply instantly, one-to-one with each incoming value —
 * routing them through a render would risk a stale/eased frame. `transition`
 * is the only style property React manages, toggled on only for the final
 * settle after the gesture ends.
 */
export function PublishDragOverlay({ activeContentId }: PublishDragOverlayProps) {
  const [preview, setPreview] = useState<PublishDragStartPayload | null>(null);
  const [committed, setCommitted] = useState(false);
  const [settling, setSettling] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cardIdRef = useRef<string | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent<PublishDragStartPayload>).detail;
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      cardIdRef.current = detail.cardId;
      setSettling(false);
      setCommitted(false);
      setPreview(detail);
    };
    const onProgress = (e: Event) => {
      const detail = (e as CustomEvent<PublishDragProgressPayload>).detail;
      if (detail.cardId !== cardIdRef.current) return;
      const panel = panelRef.current;
      if (panel) panel.style.transform = `translateY(${(1 - detail.progress) * 100}%)`;
    };
    const onEnd = (e: Event) => {
      const detail = (e as CustomEvent<PublishDragEndPayload>).detail;
      if (detail.cardId !== cardIdRef.current) return;
      setSettling(true);
      const panel = panelRef.current;
      if (detail.committed) {
        setCommitted(true);
        if (panel) panel.style.transform = "translateY(0)";
        holdTimerRef.current = setTimeout(() => {
          cardIdRef.current = null;
          setPreview(null);
        }, MAX_HOLD_MS);
      } else {
        if (panel) panel.style.transform = "translateY(100%)";
        window.setTimeout(() => {
          if (cardIdRef.current === detail.cardId) {
            cardIdRef.current = null;
            setPreview(null);
          }
        }, 300);
      }
    };

    window.addEventListener("publish-drag-start", onStart);
    window.addEventListener("publish-drag-progress", onProgress);
    window.addEventListener("publish-drag-end", onEnd);
    return () => {
      window.removeEventListener("publish-drag-start", onStart);
      window.removeEventListener("publish-drag-progress", onProgress);
      window.removeEventListener("publish-drag-end", onEnd);
    };
  }, []);

  // Initialize each newly-mounted panel below the fold before any progress
  // event has a chance to move it.
  useEffect(() => {
    if (preview && panelRef.current) panelRef.current.style.transform = "translateY(100%)";
  }, [preview]);

  // The real content for a committed drag has arrived and is already fully
  // in place underneath — lift the held panel so it can take over.
  useEffect(() => {
    if (committed && preview && activeContentId === preview.cardId) {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      cardIdRef.current = null;
      setPreview(null);
      setCommitted(false);
    }
  }, [committed, preview, activeContentId]);

  if (!preview) return null;

  return (
    <div
      ref={panelRef}
      className="fixed inset-0 z-30 bg-zinc-950"
      style={{ transition: settling ? "transform 300ms cubic-bezier(0.16, 1, 0.3, 1)" : undefined }}
    >
      {preview.type === "video" ? (
        <video
          src={preview.thumbnail ?? undefined}
          className="h-full w-full object-cover"
          muted
          autoPlay
          loop
          playsInline
        />
      ) : (preview.type === "image" || preview.type === "experience") && preview.thumbnail ? (
        // Only image/experience thumbnails are real images — document/sheet/
        // presentation/word cards carry their raw file URL here instead, which
        // isn't renderable as <img>, so those just fall through to the plain panel.
        <img src={preview.thumbnail} alt={preview.title} className="h-full w-full object-cover" />
      ) : null}
    </div>
  );
}
