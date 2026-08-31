"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, Minimize } from "lucide-react";

/**
 * Embeddable image slideshow: crossfading slides, translucent circular
 * prev/next arrows, and a Fullscreen toggle. The container element (image +
 * every control) is what goes fullscreen, so the arrows stay active while
 * fullscreen. Manual navigation only — no auto-advance.
 * `frameless`: full-bleed (no radius/shadow) with the fullscreen control moved
 * to the bottom corner, clearing the page's header overlay.
 */
export function SlideshowPanel({ images, frameless = false }: { images: string[]; frameless?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Clamp when the image list shrinks (e.g. edited live in the workspace preview).
  const safeIndex = images.length ? Math.min(index, images.length - 1) : 0;

  // Only the active slide + its immediate neighbors actually fetch — a
  // slideshow can have many images, and loading every one of them upfront
  // regardless of which is showing was competing for bandwidth with the one
  // slide that's actually visible. Once an index has loaded it stays loaded
  // (revisiting an earlier slide shouldn't re-fetch it), and the neighbors
  // are preloaded ahead of time so Prev/Next still crossfades instantly.
  const [loadedIndices, setLoadedIndices] = useState<Set<number>>(() => new Set([0]));
  useEffect(() => {
    if (!images.length) return;
    setLoadedIndices((prev) => {
      const next = new Set(prev);
      const before = next.size;
      next.add(safeIndex);
      next.add((safeIndex + 1) % images.length);
      next.add((safeIndex - 1 + images.length) % images.length);
      return next.size === before ? prev : next;
    });
  }, [safeIndex, images.length]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void el.requestFullscreen().catch(() => {});
  };

  const go = (delta: number) => {
    if (!images.length) return;
    setIndex((safeIndex + delta + images.length) % images.length);
  };

  const overlayChip = {
    background: "rgba(0, 0, 0, 0.45)",
    color: "#f2f2f2",
    border: "none",
    borderRadius: 999,
  } as const;

  // Frameless: the page's header overlay owns the top edge — park the counter
  // and fullscreen toggle in the bottom corners instead. Real fullscreen takes
  // the header out of view, so the top positions come back.
  const cornersAtBottom = frameless && !isFullscreen;
  const flat = frameless || isFullscreen;

  if (!images.length) {
    return (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ background: frameless ? "#141414" : "#e8e8e8", borderRadius: frameless ? 0 : 18 }}
      >
        <p style={{ color: "#888", fontSize: 32 }}>No images yet</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full"
      style={{
        background: isFullscreen ? "#000" : "#1a1a1a",
        borderRadius: flat ? 0 : 18,
        overflow: "hidden",
        boxShadow: flat ? "none" : "0 12px 40px rgba(0,0,0,0.18)",
      }}
    >
      {/* Slides — all stacked, crossfade + slight zoom on the active one.
          Only loaded (current ± neighbor) slides get a real `src`; the rest
          are the same absolutely-positioned box with nothing to fetch yet. */}
      {images.map((url, i) =>
        loadedIndices.has(i) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`${i}-${url}`}
            src={url}
            alt={`Slide ${i + 1}`}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: isFullscreen ? "contain" : "cover",
              opacity: i === safeIndex ? 1 : 0,
              transform: i === safeIndex ? "scale(1)" : "scale(1.03)",
              transition: "opacity 500ms ease, transform 700ms ease",
              pointerEvents: "none",
            }}
          />
        ) : (
          <div key={`${i}-${url}`} style={{ position: "absolute", inset: 0, opacity: 0, pointerEvents: "none" }} />
        )
      )}

      {/* Fullscreen toggle */}
      <button
        onClick={toggleFullscreen}
        className="absolute flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
        style={{
          ...overlayChip,
          ...(cornersAtBottom ? { bottom: 28, right: 28 } : { top: 28, right: 28 }),
          width: 64,
          height: 64,
        }}
        title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
      >
        {isFullscreen ? <Minimize size={30} /> : <Maximize size={30} />}
      </button>

      {/* Prev / next arrows */}
      {images.length > 1 ? (
        <>
          <button
            onClick={() => go(-1)}
            className="absolute flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
            style={{ ...overlayChip, left: 28, top: "50%", transform: "translateY(-50%)", width: 72, height: 72 }}
            title="Previous"
          >
            <ChevronLeft size={40} />
          </button>
          <button
            onClick={() => go(1)}
            className="absolute flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity"
            style={{ ...overlayChip, right: 28, top: "50%", transform: "translateY(-50%)", width: 72, height: 72 }}
            title="Next"
          >
            <ChevronRight size={40} />
          </button>
        </>
      ) : null}

      {/* Dots — active one elongates to a pill */}
      {images.length > 1 ? (
        <div
          className="absolute flex items-center justify-center"
          style={{ bottom: 28, left: 0, right: 0, gap: 12 }}
        >
          {images.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              className="cursor-pointer"
              style={{
                width: i === safeIndex ? 44 : 14,
                height: 14,
                borderRadius: 999,
                border: "none",
                background: i === safeIndex ? "#f2f2f2" : "rgba(255, 255, 255, 0.45)",
                transition: "width 300ms ease, background 300ms ease",
              }}
              title={`Slide ${i + 1}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
