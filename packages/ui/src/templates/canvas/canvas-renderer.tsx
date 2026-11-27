"use client";

import React, { useEffect, useRef, useState } from "react";
import { ScreenStage } from "../portfolio/components/screen-stage";
import type {
  CanvasBackground,
  CanvasContent,
  CanvasElement,
  CanvasPage,
} from "./content";

/**
 * One renderer for every place a design is drawn — the Frames editor's
 * artboard, gallery thumbnails, the preview tab, and the live screen — so what
 * an operator lays out is exactly what the screen shows. Plain DOM (not a
 * <canvas>), so text stays crisp at 4K and video plays natively.
 */

// Entrance animations. Applied to an inner wrapper so they never fight the
// element's own rotate transform on the outer box.
const ANIMATION_CSS = `
@keyframes cv-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes cv-slide-up { from { opacity: 0; transform: translateY(12%) } to { opacity: 1; transform: none } }
@keyframes cv-slide-left { from { opacity: 0; transform: translateX(12%) } to { opacity: 1; transform: none } }
@keyframes cv-zoom { from { opacity: 0; transform: scale(.85) } to { opacity: 1; transform: none } }
.cv-anim { animation-duration: .8s; animation-timing-function: cubic-bezier(.2,.7,.2,1); animation-fill-mode: both; }
`;

export function canvasBackgroundStyle(bg: CanvasBackground): React.CSSProperties {
  const layers: string[] = [];
  if (bg.imageUrl) layers.push(`url("${bg.imageUrl.replace(/"/g, '\\"')}")`);
  if (bg.gradient) {
    layers.push(`linear-gradient(${bg.gradient.angle}deg, ${bg.gradient.from}, ${bg.gradient.to})`);
  }
  return {
    backgroundColor: bg.color,
    backgroundImage: layers.length ? layers.join(", ") : undefined,
    backgroundSize: bg.imageUrl ? `${bg.imageFit}${bg.gradient ? ", cover" : ""}` : undefined,
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
  };
}

export function textStyle(el: Extract<CanvasElement, { type: "text" }>): React.CSSProperties {
  return {
    fontFamily: el.fontFamily,
    fontSize: el.fontSize,
    fontWeight: el.fontWeight,
    fontStyle: el.italic ? "italic" : "normal",
    textDecoration: el.underline ? "underline" : "none",
    textTransform: el.uppercase ? "uppercase" : "none",
    color: el.color,
    textAlign: el.align,
    lineHeight: el.lineHeight,
    letterSpacing: `${el.letterSpacing}em`,
    background: el.background ?? undefined,
    textShadow: el.shadow ? "0 0.06em 0.25em rgba(0,0,0,0.45)" : undefined,
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: "break-word",
    margin: 0,
    width: "100%",
  };
}

/** The element's visual alone, filling its box. */
export function CanvasElementBody({
  el,
  playMedia,
}: {
  el: CanvasElement;
  /** Autoplay video (screen/preview). Off in the editor and thumbnails. */
  playMedia?: boolean;
}) {
  switch (el.type) {
    case "text":
      return <div style={textStyle(el)}>{el.text || " "}</div>;
    case "shape":
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: el.fill,
            border: el.stroke && el.strokeWidth > 0 ? `${el.strokeWidth}px solid ${el.stroke}` : undefined,
            borderRadius: el.shape === "ellipse" ? "50%" : el.radius,
            boxSizing: "border-box",
          }}
        />
      );
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={el.src}
          alt=""
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: el.fit,
            borderRadius: el.radius,
            display: "block",
            userSelect: "none",
          }}
        />
      );
    case "video":
      return (
        <video
          key={`${el.src}-${playMedia ? "play" : "still"}`}
          src={playMedia ? el.src : `${el.src}#t=0.1`}
          autoPlay={playMedia}
          loop={el.loop}
          muted={playMedia ? el.muted : true}
          playsInline
          preload={playMedia ? "auto" : "metadata"}
          style={{
            width: "100%",
            height: "100%",
            objectFit: el.fit,
            borderRadius: el.radius,
            display: "block",
            pointerEvents: "none",
          }}
        />
      );
  }
}

/** An element placed on the page: position, size, rotation, opacity, entrance. */
export function CanvasElementBox({
  el,
  animate,
  playMedia,
}: {
  el: CanvasElement;
  animate?: boolean;
  playMedia?: boolean;
}) {
  const anim = animate && el.animation && el.animation !== "none" ? el.animation : null;
  return (
    <div
      style={{
        position: "absolute",
        left: el.x,
        top: el.y,
        width: el.w,
        height: el.type === "text" ? undefined : el.h,
        minHeight: el.type === "text" ? el.h : undefined,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        opacity: el.opacity,
      }}
    >
      <div
        className={anim ? "cv-anim" : undefined}
        style={{
          width: "100%",
          height: "100%",
          animationName: anim ? `cv-${anim}` : undefined,
          animationDelay: anim ? `${el.animationDelay ?? 0}s` : undefined,
        }}
      >
        <CanvasElementBody el={el} playMedia={playMedia} />
      </div>
    </div>
  );
}

/** One page at its native design size (the caller scales it). */
export function CanvasPageView({
  width,
  height,
  page,
  animate,
  playMedia,
  muteAll,
}: {
  width: number;
  height: number;
  page: CanvasPage;
  animate?: boolean;
  playMedia?: boolean;
  /** CMS mirrors of a live screen: play, but never make sound in the operator's tab. */
  muteAll?: boolean;
}) {
  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        ...canvasBackgroundStyle(page.background),
      }}
    >
      {animate && <style>{ANIMATION_CSS}</style>}
      {page.elements.map((el) => (
        <CanvasElementBox
          key={el.id}
          el={muteAll && el.type === "video" ? { ...el, muted: true } : el}
          animate={animate}
          playMedia={playMedia}
        />
      ))}
    </div>
  );
}

/**
 * A static, scaled-down page that fills its parent's width — gallery cards and
 * the editor's page strip. The parent decides the box; this keeps the aspect.
 */
export function CanvasThumbnail({
  content,
  pageIndex = 0,
  className,
  style,
}: {
  content: CanvasContent;
  pageIndex?: number;
  className?: string;
  /** Give the box a size (or an aspectRatio + width) — the page fits inside it. */
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const page = content.pages[pageIndex] ?? content.pages[0];

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const s = Math.min(node.clientWidth / content.width, node.clientHeight / content.height);
      setScale(Number.isFinite(s) && s > 0 ? s : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [content.width, content.height]);

  return (
    <div ref={ref} className={className} style={{ position: "relative", overflow: "hidden", ...style }}>
      {page && scale > 0 && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: content.width,
            height: content.height,
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: "center",
            pointerEvents: "none",
          }}
        >
          <CanvasPageView width={content.width} height={content.height} page={page} />
        </div>
      )}
    </div>
  );
}

/**
 * Full-screen playback: scales the design to fit the screen (letterboxed on
 * black) and, for multi-page designs, steps through the pages on each page's
 * own duration, looping.
 */
export function CanvasRenderer({
  content,
  preview,
  onReady,
}: {
  content: CanvasContent;
  preview?: boolean;
  onReady?: () => void;
}) {
  const [index, setIndex] = useState(0);
  const pages = content.pages;
  const page = pages[index % Math.max(1, pages.length)] ?? pages[0];

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    onReadyRef.current?.();
  }, []);

  // A re-push with fewer pages must not leave the index past the end.
  useEffect(() => {
    if (index >= pages.length) setIndex(0);
  }, [index, pages.length]);

  useEffect(() => {
    if (pages.length < 2 || !page) return;
    const t = setTimeout(
      () => setIndex((i) => (i + 1) % pages.length),
      Math.max(1, page.durationSeconds) * 1000
    );
    return () => clearTimeout(t);
  }, [page, pages.length]);

  if (!page) return null;

  return (
    <ScreenStage width={content.width} height={content.height} variant="fit-screen">
      <CanvasPageView
        key={`${page.id}-${index}`}
        width={content.width}
        height={content.height}
        page={page}
        animate
        playMedia
        muteAll={preview}
      />
    </ScreenStage>
  );
}
