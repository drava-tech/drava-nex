"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScreenStage } from "../portfolio/components/screen-stage";
import type {
  StoryApp,
  StoryAppKind,
  StoryBrand,
  StoryContent,
  StoryDetail,
  StoryFilter,
  StoryMedia,
  StoryVideoChapter,
} from "./content";

/**
 * Plays a Story on a touchscreen: idle loop → home menu → apps → detail
 * lightbox, and back to idle after a stretch with no touch. Everything is laid
 * out in design px on a fixed `width × height` surface and scaled to the
 * screen by ScreenStage, so it looks the same on any panel.
 *
 * Touch scrolling is done by hand (useDragScroll): ScreenStage sets
 * `touch-action: none` so kiosk swipes never pan the page, which also turns
 * off native overflow scrolling inside it.
 */

export type StoryView = { screen: "idle" } | { screen: "home" } | { screen: "app"; appId: string };

const CSS = `
@keyframes st-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes st-rise { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: none } }
@keyframes st-pop { from { opacity: 0; transform: scale(.94) } to { opacity: 1; transform: none } }
@keyframes st-pulse { 0% { transform: translate(-50%,-50%) scale(1); opacity: .55 } 100% { transform: translate(-50%,-50%) scale(2.4); opacity: 0 } }
@keyframes st-breathe { 0%,100% { opacity: .65 } 50% { opacity: 1 } }
@keyframes st-glow { 0%,100% { fill-opacity: .2 } 50% { fill-opacity: .42 } }
@keyframes st-kb { from { transform: scale(1) } to { transform: scale(1.14) } }
.st-root *::-webkit-scrollbar { display: none }
.st-root * { scrollbar-width: none }
.st-tap { transition: transform .15s ease, filter .15s ease }
.st-tap:active { transform: scale(.97); filter: brightness(1.08) }
`;

// ─── Hooks ────────────────────────────────────────────────────────────────────

/** Drag-to-scroll that works under a CSS-scaled stage and swallows the click a drag ends with. */
function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let left = 0;
    let top = 0;
    let scale = 1;
    let active = false;
    let dragged = false;
    let pid = -1;

    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      active = true;
      dragged = false;
      pid = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      left = el.scrollLeft;
      top = el.scrollTop;
      scale = el.getBoundingClientRect().width / (el.offsetWidth || 1) || 1;
    };
    const move = (e: PointerEvent) => {
      if (!active || e.pointerId !== pid) return;
      const dx = (e.clientX - startX) / scale;
      const dy = (e.clientY - startY) / scale;
      if (!dragged && Math.hypot(dx, dy) > 8) {
        dragged = true;
        try {
          el.setPointerCapture(pid);
        } catch {
          /* pointer already gone */
        }
      }
      if (dragged) {
        el.scrollLeft = left - dx;
        el.scrollTop = top - dy;
      }
    };
    const up = () => {
      active = false;
    };
    const click = (e: MouseEvent) => {
      if (dragged) {
        e.stopPropagation();
        e.preventDefault();
        dragged = false;
      }
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("click", click, true);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("click", click, true);
    };
  }, []);
  return ref;
}

/** Size of a box (design px — offset sizes ignore the stage's CSS scale). */
function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// ─── Icons (inline so the package stays dependency-free) ─────────────────────

function Icon({ d, size, color, stroke = 2 }: { d: string; size: number; color: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  close: "M18 6 6 18M6 6l12 12",
  left: "m15 18-6-6 6-6",
  right: "m9 18 6-6-6-6",
  timeline: "M3 12h18M7 8v8M12 5v14M17 9v6",
  map: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  showcase: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  hotspots: "M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M12 12m-8 0a8 8 0 1 0 16 0 8 8 0 1 0-16 0",
  file: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5",
  video: "M3 6h12v12H3zM15 10l6-4v12l-6-4",
  play: "M7 4v16l13-8z",
  pause: "M7 4h3v16H7zM14 4h3v16h-3z",
  next: "m6 18 8.5-6L6 6zM17 6v12",
  prev: "m18 18-8.5-6L18 6zM7 6v12",
} as const;

export const STORY_APP_ICON: Record<StoryAppKind, string> = {
  timeline: ICONS.timeline,
  map: ICONS.map,
  showcase: ICONS.showcase,
  hotspots: ICONS.hotspots,
  video: ICONS.video,
};

// ─── Shared bits ──────────────────────────────────────────────────────────────

interface Ctx {
  brand: StoryBrand;
  /** Type scale unit: 1 at 1080 px on the short side. */
  u: number;
  portrait: boolean;
  open: (d: StoryDetail) => void;
  /** Counts as a touch for the idle timer — anything playing calls it so the wall doesn't go idle mid-story. */
  poke: () => void;
}

function Chips({
  ctx,
  filters,
  active,
  onToggle,
  allLabel = "All",
  showAll = true,
  dots = false,
}: {
  ctx: Ctx;
  filters: StoryFilter[];
  active: Set<string>;
  onToggle: (id: string | null) => void;
  allLabel?: string;
  showAll?: boolean;
  dots?: boolean;
}) {
  const { brand, u } = ctx;
  const scroller = useDragScroll<HTMLDivElement>();
  if (filters.length === 0) return null;
  const chip = (key: string, label: string, on: boolean, onClick: () => void, color?: string) => (
    <button
      key={key}
      type="button"
      className="st-tap"
      onClick={onClick}
      style={{
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10 * u,
        height: 56 * u,
        padding: `0 ${26 * u}px`,
        borderRadius: 999,
        border: `${2 * u}px solid ${on ? brand.accent : "rgba(127,127,127,.35)"}`,
        background: on ? brand.accent : "transparent",
        color: on ? brand.accentText : brand.text,
        font: `600 ${22 * u}px ${brand.bodyFont}`,
        cursor: "pointer",
      }}
    >
      {dots && color && <span style={{ width: 14 * u, height: 14 * u, borderRadius: 99, background: color, boxShadow: `0 0 0 ${2 * u}px rgba(255,255,255,.6)` }} />}
      {label}
    </button>
  );
  return (
    <div ref={scroller} style={{ display: "flex", gap: 12 * u, overflowX: "auto", paddingBottom: 4 * u }}>
      {showAll && chip("all", allLabel, active.size === 0, () => onToggle(null))}
      {filters.map((f) => chip(f.id, f.label, active.has(f.id), () => onToggle(f.id), f.color))}
    </div>
  );
}

/** Fits a box of a given aspect ratio into the available area (for pinned images). */
function FittedImage({
  url,
  ctx,
  children,
  grid,
}: {
  url: string | null;
  ctx: Ctx;
  children: (box: { w: number; h: number }) => React.ReactNode;
  grid?: boolean;
}) {
  const [areaRef, area] = useBoxSize<HTMLDivElement>();
  const [ratio, setRatio] = useState(16 / 9);
  useEffect(() => {
    if (!url) {
      setRatio(area.w && area.h ? area.w / area.h : 16 / 9);
      return;
    }
    const img = new Image();
    img.onload = () => img.naturalWidth && setRatio(img.naturalWidth / img.naturalHeight);
    img.src = url;
  }, [url, area.w, area.h]);

  const box =
    area.w && area.h
      ? area.w / area.h > ratio
        ? { w: area.h * ratio, h: area.h }
        : { w: area.w, h: area.w / ratio }
      : { w: 0, h: 0 };

  return (
    <div ref={areaRef} style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      {box.w > 0 && (
        <div
          style={{
            position: "relative",
            width: box.w,
            height: box.h,
            borderRadius: ctx.brand.radius * ctx.u,
            overflow: "hidden",
            background: url
              ? `center / cover no-repeat url("${url.replace(/"/g, '\\"')}")`
              : grid
                ? `repeating-linear-gradient(0deg, rgba(127,127,127,.14) 0 1px, transparent 1px ${60 * ctx.u}px), repeating-linear-gradient(90deg, rgba(127,127,127,.14) 0 1px, transparent 1px ${60 * ctx.u}px), ${ctx.brand.surface}`
                : ctx.brand.surface,
          }}
        >
          {children(box)}
        </div>
      )}
    </div>
  );
}

function Cover({ url, ctx, kind, style }: { url: string | null; ctx: Ctx; kind?: StoryAppKind; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        background: url ? `center / cover no-repeat url("${url.replace(/"/g, '\\"')}")` : `linear-gradient(135deg, ${ctx.brand.accent}, ${ctx.brand.surface})`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      {!url && kind && <Icon d={STORY_APP_ICON[kind]} size={96 * ctx.u} color={ctx.brand.accentText} stroke={1.6} />}
    </div>
  );
}

// ─── Idle ─────────────────────────────────────────────────────────────────────

function IdleScreen({ content, ctx, onStart, animate }: { content: StoryContent; ctx: Ctx; onStart: () => void; animate: boolean }) {
  const { brand, u } = ctx;
  const slides = content.idle.slides;
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!animate || slides.length < 2) return;
    const t = setTimeout(() => setI((x) => (x + 1) % slides.length), content.idle.slideSeconds * 1000);
    return () => clearTimeout(t);
  }, [animate, i, slides.length, content.idle.slideSeconds]);
  const s = slides[i % Math.max(1, slides.length)];

  return (
    <div onClick={onStart} style={{ position: "absolute", inset: 0, cursor: "pointer", overflow: "hidden" }}>
      {s && (
        <div key={s.id} style={{ position: "absolute", inset: 0, animation: animate ? "st-fade 1s ease both" : undefined }}>
          {s.mediaUrl && s.mediaType === "video" ? (
            <video src={s.mediaUrl} autoPlay={animate} muted loop playsInline style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          ) : s.mediaUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.mediaUrl} alt="" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
          ) : null}
          <div style={{ position: "absolute", inset: 0, background: s.mediaUrl ? "linear-gradient(180deg, rgba(0,0,0,.05) 30%, rgba(0,0,0,.75))" : "transparent" }} />
          <div
            style={{
              position: "absolute",
              left: 110 * u,
              right: 110 * u,
              bottom: 230 * u,
              color: s.mediaUrl ? "#fff" : brand.text,
              animation: animate ? "st-rise .9s .2s ease both" : undefined,
            }}
          >
            {s.headline && <div style={{ font: `700 ${(ctx.portrait ? 92 : 104) * u}px/1.02 ${brand.headingFont}`, maxWidth: 1500 * u }}>{s.headline}</div>}
            {s.body && <div style={{ marginTop: 24 * u, font: `400 ${36 * u}px/1.35 ${brand.bodyFont}`, maxWidth: 1100 * u, opacity: 0.88 }}>{s.body}</div>}
          </div>
        </div>
      )}
      {brand.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={brand.logoUrl} alt="" draggable={false} style={{ position: "absolute", top: 80 * u, left: 110 * u, height: 84 * u, objectFit: "contain" }} />
      )}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 90 * u,
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: 16 * u,
          padding: `${20 * u}px ${40 * u}px`,
          borderRadius: 999,
          background: brand.accent,
          color: brand.accentText,
          font: `700 ${26 * u}px ${brand.bodyFont}`,
          letterSpacing: "0.04em",
          animation: animate ? "st-breathe 2.4s ease-in-out infinite" : undefined,
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ width: 14 * u, height: 14 * u, borderRadius: 99, background: brand.accentText }} />
        {content.idle.prompt}
      </div>
      {slides.length > 1 && (
        <div style={{ position: "absolute", right: 110 * u, bottom: 112 * u, display: "flex", gap: 10 * u }}>
          {slides.map((x, k) => (
            <span key={x.id} style={{ width: k === i ? 36 * u : 12 * u, height: 12 * u, borderRadius: 99, background: s?.mediaUrl ? "#fff" : brand.text, opacity: k === i ? 1 : 0.4, transition: "width .3s" }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Home ─────────────────────────────────────────────────────────────────────

function HomeScreen({ content, ctx, onOpen, animate }: { content: StoryContent; ctx: Ctx; onOpen: (id: string) => void; animate: boolean }) {
  const { brand, u, portrait } = ctx;
  const n = content.apps.length;
  const cols = portrait ? (n <= 1 ? 1 : 2) : Math.max(1, Math.min(n, n === 4 ? 4 : 3));
  const pad = 110 * u;
  const scroller = useDragScroll<HTMLDivElement>();
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", padding: `${80 * u}px ${pad}px ${pad}px` }}>
      {content.home.backgroundUrl && (
        <div style={{ position: "absolute", inset: 0, background: `center / cover no-repeat url("${content.home.backgroundUrl.replace(/"/g, '\\"')}")`, opacity: 0.35 }} />
      )}
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 84 * u }}>
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt="" draggable={false} style={{ height: 84 * u, objectFit: "contain" }} />
        ) : (
          <span />
        )}
      </div>
      <div style={{ position: "relative", marginTop: (portrait ? 120 : 60) * u, animation: animate ? "st-rise .7s ease both" : undefined }}>
        <div style={{ font: `700 ${(portrait ? 96 : 92) * u}px/1.02 ${brand.headingFont}`, color: brand.text }}>{content.home.headline}</div>
        {content.home.subheadline && (
          <div style={{ marginTop: 20 * u, font: `400 ${34 * u}px/1.35 ${brand.bodyFont}`, color: brand.muted }}>{content.home.subheadline}</div>
        )}
      </div>
      <div
        ref={scroller}
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          marginTop: 64 * u,
          overflowY: "auto",
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          // One row of up to 4 tiles fills the height; more tiles get fixed-height rows that scroll.
          gridAutoRows: portrait ? `${520 * u}px` : n <= 4 ? "minmax(0, 1fr)" : `${440 * u}px`,
          gap: 32 * u,
          alignContent: n === 0 ? "center" : "stretch",
        }}
      >
        {n === 0 && (
          <div style={{ gridColumn: `1 / -1`, textAlign: "center", color: brand.muted, font: `400 ${30 * u}px ${brand.bodyFont}` }}>
            Add an app to this story to fill the menu.
          </div>
        )}
        {content.apps.map((app, k) => (
          <button
            key={app.id}
            type="button"
            className="st-tap"
            onClick={() => onOpen(app.id)}
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              minHeight: 0,
              borderRadius: brand.radius * u,
              background: brand.surface,
              border: "none",
              padding: 0,
              textAlign: "left",
              cursor: "pointer",
              animation: animate ? `st-pop .6s ${0.08 * k + 0.15}s ease both` : undefined,
            }}
          >
            <Cover url={app.coverUrl} ctx={ctx} kind={app.kind} style={{ flex: 1, minHeight: 0, width: "100%" }} />
            <div style={{ padding: `${28 * u}px ${32 * u}px ${32 * u}px` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 * u, color: brand.accent }}>
                <Icon d={STORY_APP_ICON[app.kind]} size={28 * u} color={brand.accent} />
              </div>
              <div style={{ marginTop: 12 * u, font: `700 ${40 * u}px/1.1 ${brand.headingFont}`, color: brand.text }}>{app.title}</div>
              {app.tagline && <div style={{ marginTop: 8 * u, font: `400 ${24 * u}px/1.35 ${brand.bodyFont}`, color: brand.muted }}>{app.tagline}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Apps ─────────────────────────────────────────────────────────────────────

function TimelineView({ app, ctx }: { app: Extract<StoryApp, { kind: "timeline" }>; ctx: Ctx }) {
  const { brand, u, portrait } = ctx;
  const events = useMemo(() => [...app.events].sort((a, b) => a.year - b.year), [app.events]);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const scroller = useDragScroll<HTMLDivElement>();
  const refs = useRef(new Map<string, HTMLElement>());

  const jump = (id: string | null) => {
    setActiveFilter(id);
    const el = scroller.current;
    if (!el) return;
    const first = id ? events.find((e) => e.filterId === id) : events[0];
    const node = first && refs.current.get(first.id);
    if (!node) return;
    el.scrollTo({ left: portrait ? 0 : node.offsetLeft - 110 * u, top: portrait ? node.offsetTop - 40 * u : 0, behavior: "smooth" });
  };

  const cardW = 520 * u;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 36 * u }}>
      <div style={{ padding: `0 ${110 * u}px` }}>
        <Chips ctx={ctx} filters={app.filters} active={new Set(activeFilter ? [activeFilter] : [])} onToggle={jump} allLabel="All" />
      </div>
      {events.length === 0 ? (
        <Empty ctx={ctx} text="No milestones yet." />
      ) : (
        <div
          ref={scroller}
          style={{
            position: "relative",
            flex: 1,
            minHeight: 0,
            overflowX: portrait ? "hidden" : "auto",
            overflowY: portrait ? "auto" : "hidden",
          }}
        >
          <div
            style={{
              position: "relative",
              display: "flex",
              flexDirection: portrait ? "column" : "row",
              gap: (portrait ? 40 : 48) * u,
              padding: portrait ? `${20 * u}px ${110 * u}px ${80 * u}px ${190 * u}px` : `${40 * u}px ${110 * u}px`,
              boxSizing: "border-box",
              height: portrait ? undefined : "100%",
              width: portrait ? undefined : "max-content",
              alignItems: portrait ? "stretch" : "center",
            }}
          >
            {/* The spine */}
            <div
              style={
                portrait
                  ? { position: "absolute", left: 140 * u, top: 0, bottom: 0, width: 4 * u, background: `linear-gradient(${brand.accent}, transparent)` }
                  : { position: "absolute", left: 0, right: 0, top: "50%", height: 4 * u, background: `linear-gradient(90deg, ${brand.accent}, rgba(127,127,127,.25))` }
              }
            />
            {events.map((ev, k) => {
              const filter = app.filters.find((f) => f.id === ev.filterId);
              const dim = activeFilter && ev.filterId !== activeFilter;
              const above = !portrait && k % 2 === 0;
              const thumb = ev.media.find((m) => m.type === "image")?.url ?? null;
              const card = (
                <button
                  type="button"
                  className="st-tap"
                  onClick={() => ctx.open(ev)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    textAlign: "left",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    overflow: "hidden",
                    borderRadius: brand.radius * u,
                    background: brand.surface,
                    maxHeight: "100%",
                    flexShrink: 1,
                    minHeight: 0,
                  }}
                >
                  {thumb && (
                    <Cover
                      url={thumb}
                      ctx={ctx}
                      style={{ width: "100%", flex: `0 1 ${(portrait ? 300 : 240) * u}px`, minHeight: 60 * u, height: (portrait ? 300 : 240) * u }}
                    />
                  )}
                  <div style={{ padding: `${24 * u}px ${28 * u}px ${28 * u}px`, flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 * u }}>
                      <span style={{ font: `700 ${44 * u}px/1 ${brand.headingFont}`, color: brand.accent }}>{ev.dateLabel || ev.year}</span>
                      {filter && (
                        <span style={{ font: `600 ${18 * u}px ${brand.bodyFont}`, color: brand.muted, textTransform: "uppercase", letterSpacing: "0.12em" }}>{filter.label}</span>
                      )}
                    </div>
                    <div style={{ marginTop: 12 * u, font: `700 ${32 * u}px/1.15 ${brand.headingFont}`, color: brand.text }}>{ev.title}</div>
                    {ev.subtitle && <div style={{ marginTop: 8 * u, font: `400 ${22 * u}px/1.35 ${brand.bodyFont}`, color: brand.muted }}>{ev.subtitle}</div>}
                  </div>
                </button>
              );
              return (
                <div
                  key={ev.id}
                  ref={(n) => {
                    if (n) refs.current.set(ev.id, n);
                  }}
                  style={{
                    position: "relative",
                    width: portrait ? undefined : cardW,
                    flexShrink: 0,
                    height: portrait ? undefined : "100%",
                    // Landscape: columns overlap by half a card, alternating
                    // above/below the spine, so neighbours interleave.
                    marginLeft: !portrait && k > 0 ? -cardW / 2 : undefined,
                    display: "flex",
                    flexDirection: "column",
                    opacity: dim ? 0.3 : 1,
                    transition: "opacity .3s",
                  }}
                >
                  {/* Marker on the spine */}
                  <div
                    style={
                      portrait
                        ? { position: "absolute", left: -58 * u, top: 34 * u, width: 28 * u, height: 28 * u, borderRadius: 99, background: brand.accent, boxShadow: `0 0 0 ${8 * u}px ${brand.background}` }
                        : { position: "absolute", left: 40 * u, top: "50%", width: 28 * u, height: 28 * u, marginTop: -14 * u, borderRadius: 99, background: brand.accent, boxShadow: `0 0 0 ${8 * u}px ${brand.background}` }
                    }
                  />
                  {portrait ? (
                    card
                  ) : (
                    <>
                      {/* Top half: card hugs the spine from above. */}
                      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", paddingBottom: 44 * u }}>
                        {above && card}
                      </div>
                      {/* Bottom half: card hangs from the spine. */}
                      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", justifyContent: "flex-start", paddingTop: 44 * u }}>
                        {!above && card}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Pin({
  x,
  y,
  color,
  label,
  onClick,
  ctx,
  number,
  dim,
  big,
}: {
  x: number;
  y: number;
  color: string;
  label?: string;
  onClick: () => void;
  ctx: Ctx;
  number?: number;
  dim?: boolean;
  big?: boolean;
}) {
  const { u, brand } = ctx;
  const d = (number !== undefined ? (big ? 68 : 52) : 34) * u;
  // A finger-sized hit area centred on the point, bigger than the dot itself.
  const hit = 96 * u;
  return (
    <button
      type="button"
      aria-label={label ?? (number !== undefined ? String(number) : "Point")}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        position: "absolute",
        left: `${x}%`,
        top: `${y}%`,
        width: hit,
        height: hit,
        transform: "translate(-50%, -50%)",
        border: "none",
        padding: 0,
        background: "none",
        cursor: "pointer",
        opacity: dim ? 0.45 : 1,
        zIndex: big ? 2 : 1,
        transition: "opacity .4s",
      }}
    >
      {!dim && <span style={{ position: "absolute", left: "50%", top: "50%", width: d, height: d, borderRadius: 99, background: color, animation: "st-pulse 2s ease-out infinite" }} />}
      <span
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: d,
          height: d,
          transform: "translate(-50%,-50%)",
          transition: "width .35s, height .35s",
          borderRadius: 99,
          background: color,
          border: `${4 * u}px solid #fff`,
          boxShadow: "0 4px 18px rgba(0,0,0,.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: `700 ${22 * u}px ${brand.bodyFont}`,
          color: "#111",
        }}
      >
        {number}
      </span>
      {label && (
        <span
          style={{
            position: "absolute",
            left: hit / 2 + d / 2 + 10 * u,
            top: "50%",
            transform: "translateY(-50%)",
            whiteSpace: "nowrap",
            padding: `${6 * u}px ${14 * u}px`,
            borderRadius: 999,
            background: "rgba(10,10,14,.78)",
            color: "#fff",
            font: `600 ${20 * u}px ${brand.bodyFont}`,
          }}
        >
          {label}
        </span>
      )}
    </button>
  );
}

function useFilterSet() {
  const [on, setOn] = useState<Set<string>>(new Set());
  const toggle = (id: string | null) =>
    setOn((prev) => {
      if (id === null) return new Set();
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return [on, toggle] as const;
}

function MapView({ app, ctx }: { app: Extract<StoryApp, { kind: "map" }>; ctx: Ctx }) {
  if (app.mode === "journey") return <JourneyMap app={app} ctx={ctx} />;
  if (app.mode === "regions") return <RegionsMap app={app} ctx={ctx} />;
  return <PinsMap app={app} ctx={ctx} />;
}

function PinsMap({ app, ctx }: { app: Extract<StoryApp, { kind: "map" }>; ctx: Ctx }) {
  const [on, toggle] = useFilterSet();
  const visible = app.pins.filter((p) => on.size === 0 || (p.filterId && on.has(p.filterId)));
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 32 * ctx.u, padding: `0 ${110 * ctx.u}px ${80 * ctx.u}px` }}>
      <Chips ctx={ctx} filters={app.filters} active={on} onToggle={toggle} allLabel="Everything" dots />
      <FittedImage url={app.mapUrl} ctx={ctx} grid>
        {() =>
          visible.map((p) => (
            <Pin
              key={p.id}
              x={p.x}
              y={p.y}
              ctx={ctx}
              color={app.filters.find((f) => f.id === p.filterId)?.color ?? ctx.brand.accent}
              label={p.title}
              onClick={() => ctx.open(p)}
            />
          ))
        }
      </FittedImage>
    </div>
  );
}

type Pt = { x: number; y: number };

/** The control point of a gentle arc from a to b (so a route reads as travel, not a ruler line). */
function arcControl(a: Pt, b: Pt): Pt {
  const bend = 0.18;
  return { x: (a.x + b.x) / 2 - (b.y - a.y) * bend, y: (a.y + b.y) / 2 + (b.x - a.x) * bend };
}

function arc(a: Pt, b: Pt): string {
  const c = arcControl(a, b);
  return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
}

/** Point t (0–1) along that arc. */
function onArc(a: Pt, b: Pt, t: number): Pt {
  const c = arcControl(a, b);
  const s = 1 - t;
  return { x: s * s * a.x + 2 * s * t * c.x + t * t * b.x, y: s * s * a.y + 2 * s * t * c.y + t * t * b.y };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Seconds a journey takes per leg when playing, and how long it rests at each stop. */
const LEG_SECONDS = 2.4;
const STOP_HOLD_SECONDS = 1.4;

/** Degrees of dial travel used for the whole journey (the gap is at the bottom). */
const DIAL_SPAN = 280;
const DIAL_START = -DIAL_SPAN / 2;

/** SVG arc along a circle, angles in degrees clockwise from 12 o'clock. */
function ringArc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => {
    const rad = (a * Math.PI) / 180;
    return `${cx + r * Math.sin(rad)} ${cy - r * Math.cos(rad)}`;
  };
  if (a1 - a0 < 0.01) return `M ${p(a0)}`;
  return `M ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p(a1)}`;
}

/**
 * A round jog dial for the journey — made for touch tables. Turn it with a
 * finger around the ring, or set a tangible dial puck on it: a capacitive
 * puck's feet register as several touches turning together, so every active
 * touch contributes its share of the rotation. The knob tracks the finger
 * 1:1 along the ring, stops are ticks on it, the centre opens the current
 * stop and a tap on a tick jumps there. Scroll wheels and rotary controllers
 * that send wheel input step one stop per notch.
 */
function JourneyDial({
  ctx,
  count,
  pos,
  size,
  colorOf,
  title,
  onTurn,
  onRelease,
  onPick,
  onCenter,
  onStep,
}: {
  ctx: Ctx;
  count: number;
  pos: number;
  size: number;
  colorOf: (k: number) => string;
  title: string;
  /** Rotation in stops (fractional). */
  onTurn: (deltaStops: number) => void;
  onRelease: () => void;
  onPick: (k: number) => void;
  onCenter: () => void;
  onStep: (dir: -1 | 1) => void;
}) {
  const { brand, u } = ctx;
  const ref = useRef<HTMLDivElement>(null);
  const per = count > 1 ? DIAL_SPAN / (count - 1) : DIAL_SPAN;
  const angleOf = (p: number) => DIAL_START + clamp(p, 0, Math.max(0, count - 1)) * per;
  const touches = useRef(new Map<number, { last: number; travel: number; startX: number; startY: number }>());
  const lastWheel = useRef(0);

  const D = size;
  const c = D / 2;
  const ringR = D / 2 - 46 * u;
  const hubR = D * 0.27;

  const polar = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return {
      // Degrees clockwise from 12 o'clock.
      angle: (Math.atan2(dx, -dy) * 180) / Math.PI,
      // 0 at the centre, 1 at the rim — scale-free, so it works under the stage's CSS scale.
      radius: Math.hypot(dx, dy) / (r.width / 2),
    };
  };

  const down = (e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      /* already gone */
    }
    touches.current.set(e.pointerId, { last: polar(e).angle, travel: 0, startX: e.clientX, startY: e.clientY });
  };

  const move = (e: React.PointerEvent) => {
    const t = touches.current.get(e.pointerId);
    if (!t) return;
    const p = polar(e);
    let d = p.angle - t.last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    t.last = p.angle;
    // Near the centre the angle swings wildly for tiny moves — ignore it there.
    if (p.radius < 0.18) return;
    t.travel += Math.abs(d);
    // Each touch turns the dial by its share, so a three-footed puck turns it once, not three times.
    onTurn(d / per / touches.current.size);
  };

  const up = (e: React.PointerEvent) => {
    const t = touches.current.get(e.pointerId);
    if (!t) return;
    touches.current.delete(e.pointerId);
    const p = polar(e);
    const moved = Math.hypot(e.clientX - t.startX, e.clientY - t.startY);
    const box = ref.current!.getBoundingClientRect().width;
    // A tap, not a turn: the centre opens the stop, the ring jumps to the nearest tick.
    if (t.travel < 6 && moved < box * 0.04 && touches.current.size === 0) {
      if (p.radius < (hubR / (D / 2)) * 1.05) onCenter();
      else if (count > 0) onPick(Math.round(clamp((p.angle - DIAL_START) / per, 0, count - 1)));
      return;
    }
    if (touches.current.size === 0) onRelease();
  };

  const wheel = (e: React.WheelEvent) => {
    const now = performance.now();
    if (now - lastWheel.current < 140 || Math.abs(e.deltaY) + Math.abs(e.deltaX) < 1) return;
    lastWheel.current = now;
    onStep((e.deltaY || e.deltaX) > 0 ? 1 : -1);
  };

  const knobA = angleOf(pos);
  const knobRad = (knobA * Math.PI) / 180;
  const step = Math.round(clamp(pos, 0, Math.max(0, count - 1)));
  const accent = colorOf(step);

  return (
    <div
      ref={ref}
      role="slider"
      aria-label="Journey dial"
      aria-valuemin={1}
      aria-valuemax={count}
      aria-valuenow={step + 1}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onWheel={wheel}
      style={{ position: "relative", width: D, height: D, flexShrink: 0, touchAction: "none", cursor: "grab" }}
    >
      <svg width={D} height={D} viewBox={`0 0 ${D} ${D}`} style={{ position: "absolute", inset: 0, overflow: "visible", filter: "drop-shadow(0 18px 40px rgba(0,0,0,.35))" }}>
        <circle cx={c} cy={c} r={D / 2 - 2} fill={brand.surface} />
        {/* Knurled rim — turns with the dial, so it feels like a physical knob. */}
        <g transform={`rotate(${pos * per} ${c} ${c})`}>
          {Array.from({ length: 72 }, (_, i) => {
            const a = (i * 5 * Math.PI) / 180;
            const r0 = D / 2 - 14 * u;
            const r1 = D / 2 - 4 * u;
            return (
              <line
                key={i}
                x1={c + r0 * Math.sin(a)}
                y1={c - r0 * Math.cos(a)}
                x2={c + r1 * Math.sin(a)}
                y2={c - r1 * Math.cos(a)}
                stroke={brand.text}
                strokeOpacity={0.18}
                strokeWidth={2 * u}
                strokeLinecap="round"
              />
            );
          })}
        </g>
        <path d={ringArc(c, c, ringR, DIAL_START, DIAL_START + DIAL_SPAN)} fill="none" stroke={brand.text} strokeOpacity={0.14} strokeWidth={14 * u} strokeLinecap="round" />
        {count > 0 && <path d={ringArc(c, c, ringR, DIAL_START, knobA)} fill="none" stroke={accent} strokeWidth={14 * u} strokeLinecap="round" />}
        {Array.from({ length: count }, (_, k) => {
          const a = (angleOf(k) * Math.PI) / 180;
          const passed = k <= pos + 0.001;
          const labelR = ringR - 44 * u;
          return (
            <g key={k}>
              <circle
                cx={c + ringR * Math.sin(a)}
                cy={c - ringR * Math.cos(a)}
                r={(k === step ? 13 : 9) * u}
                fill={passed ? colorOf(k) : brand.surface}
                stroke={passed ? brand.surface : brand.muted}
                strokeWidth={3 * u}
              />
              {count <= 14 && (
                <text
                  x={c + labelR * Math.sin(a)}
                  y={c - labelR * Math.cos(a)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  style={{ font: `${k === step ? 700 : 500} ${20 * u}px ${brand.bodyFont}` }}
                  fill={k === step ? brand.text : brand.muted}
                >
                  {k + 1}
                </text>
              )}
            </g>
          );
        })}
        {/* The knob */}
        <circle cx={c + ringR * Math.sin(knobRad)} cy={c - ringR * Math.cos(knobRad)} r={30 * u} fill={accent} stroke="#fff" strokeWidth={6 * u} />
        <circle cx={c} cy={c} r={hubR} fill={brand.background} />
      </svg>
      {/* Hub: the current stop; tap it to read. */}
      <div
        style={{
          position: "absolute",
          left: c - hubR,
          top: c - hubR,
          width: hubR * 2,
          height: hubR * 2,
          borderRadius: 999,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: 18 * u,
          boxSizing: "border-box",
          pointerEvents: "none",
        }}
      >
        <span style={{ font: `700 ${68 * u}px/1 ${brand.headingFont}`, color: accent }}>{String(step + 1).padStart(2, "0")}</span>
        <span style={{ marginTop: 6 * u, font: `600 ${16 * u}px ${brand.bodyFont}`, color: brand.muted, textTransform: "uppercase", letterSpacing: "0.14em" }}>of {count}</span>
        <span
          style={{
            marginTop: 8 * u,
            font: `700 ${20 * u}px/1.2 ${brand.headingFont}`,
            color: brand.text,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {title}
        </span>
      </div>
    </div>
  );
}

/**
 * The pins as an ordered route. Position along the journey is continuous —
 * the route draws itself and a traveller moves along it as the dial turns, or
 * as Play walks it stop by stop — so expansion or travel reads as movement.
 */
function JourneyMap({ app, ctx }: { app: Extract<StoryApp, { kind: "map" }>; ctx: Ctx }) {
  const { brand, u, portrait } = ctx;
  const stops = app.pins;
  const last = Math.max(0, stops.length - 1);
  const [pos, setPosState] = useState(0);
  const posRef = useRef(0);
  const setPos = useCallback(
    (p: number) => {
      posRef.current = clamp(p, 0, last);
      setPosState(posRef.current);
    },
    [last]
  );
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);
  const poke = useRef(ctx.poke);
  poke.current = ctx.poke;

  const halt = () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };
  useEffect(() => halt, []);

  /** Glide to a position (a stop, usually), easing in and out. */
  const glideTo = useCallback(
    (target: number) => {
      halt();
      const from = posRef.current;
      const to = clamp(target, 0, last);
      if (Math.abs(to - from) < 0.001) return setPos(to);
      const dur = Math.min(1600, 380 + Math.abs(to - from) * 650);
      const t0 = performance.now();
      const tick = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        setPos(from + (to - from) * e);
        raf.current = k < 1 ? requestAnimationFrame(tick) : null;
      };
      raf.current = requestAnimationFrame(tick);
    },
    [last, setPos]
  );

  // Play: walk each leg, rest at each stop, stop at the end.
  useEffect(() => {
    if (!playing) return;
    halt();
    let prev = performance.now();
    let hold = 0;
    const tick = (now: number) => {
      const dt = (now - prev) / 1000;
      prev = now;
      if (hold > 0) {
        hold -= dt;
      } else {
        const before = posRef.current;
        let next = before + dt / LEG_SECONDS;
        if (Math.floor(next) > Math.floor(before + 1e-6)) {
          next = Math.floor(next);
          hold = STOP_HOLD_SECONDS;
          poke.current();
        }
        setPos(next);
        if (next >= last) {
          setPlaying(false);
          raf.current = null;
          return;
        }
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return halt;
  }, [playing, last, setPos]);

  const step = Math.round(pos);
  const cur = stops[step];

  // A tiny haptic click at each stop, where the hardware has one.
  const lastStep = useRef(step);
  useEffect(() => {
    if (lastStep.current !== step) {
      lastStep.current = step;
      try {
        navigator.vibrate?.(8);
      } catch {
        /* not supported */
      }
    }
  }, [step]);

  const goStep = useCallback(
    (k: number) => {
      setPlaying(false);
      glideTo(Math.round(k));
      poke.current();
    },
    [glideTo]
  );

  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (posRef.current >= last - 0.001) setPos(0);
    else setPos(Math.round(posRef.current));
    setPlaying(true);
  };

  // Keyboard-style rotary controllers (and arrow keys) step stops; Enter reads one.
  const keyState = useRef({ step, cur, goStep, open: ctx.open, togglePlay });
  keyState.current = { step, cur, goStep, open: ctx.open, togglePlay };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never steal keys from a form field (the editor's live preview runs this too).
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName))) return;
      const s = keyState.current;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown") s.goStep(s.step + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") s.goStep(s.step - 1);
      else if (e.key === "Enter" && s.cur) s.open(s.cur);
      else if (e.key === " ") s.togglePlay();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const colorOf = (filterId: string | null) => app.filters.find((f) => f.id === filterId)?.color ?? brand.accent;
  const stopColor = (k: number) => colorOf(stops[k]?.filterId ?? null);

  const roundBtn = (d: string, label: string, onClick: () => void, disabled = false, primary = false) => (
    <button
      type="button"
      className="st-tap"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 88 * u,
        height: 88 * u,
        flexShrink: 0,
        borderRadius: 99,
        border: "none",
        background: primary ? brand.accent : brand.surface,
        opacity: disabled ? 0.35 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
      }}
    >
      <Icon d={d} size={36 * u} color={primary ? brand.accentText : brand.text} />
    </button>
  );

  const stopCard = (compact: boolean) =>
    cur && (
      <button
        type="button"
        className="st-tap"
        onClick={() => ctx.open(cur)}
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 24 * u,
          padding: `${18 * u}px ${30 * u}px`,
          borderRadius: brand.radius * u,
          border: "none",
          background: brand.surface,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        {!compact && <span style={{ font: `700 ${44 * u}px/1 ${brand.headingFont}`, color: stopColor(step), flexShrink: 0 }}>{String(step + 1).padStart(2, "0")}</span>}
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: "block", font: `600 ${18 * u}px ${brand.bodyFont}`, color: brand.muted, textTransform: "uppercase", letterSpacing: "0.12em" }}>
            Stop {step + 1} of {stops.length}
            {cur.subtitle ? ` · ${cur.subtitle}` : ""}
          </span>
          <span style={{ display: "block", marginTop: 6 * u, font: `700 ${32 * u}px/1.15 ${brand.headingFont}`, color: brand.text, whiteSpace: compact ? "normal" : "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cur.title}</span>
          {compact && <span style={{ display: "block", marginTop: 10 * u, font: `600 ${20 * u}px ${brand.bodyFont}`, color: brand.accent }}>Read more</span>}
        </span>
        {!compact && <span style={{ font: `600 ${20 * u}px ${brand.bodyFont}`, color: brand.accent, flexShrink: 0 }}>Read more</span>}
      </button>
    );

  const map = (
    <FittedImage url={app.mapUrl} ctx={ctx} grid>
      {(box) => {
        const pts = stops.map((p) => ({ x: (p.x / 100) * box.w, y: (p.y / 100) * box.h }));
        const leg = Math.min(Math.floor(pos), Math.max(0, pts.length - 2));
        const traveller = pts.length > 1 ? onArc(pts[leg]!, pts[leg + 1]!, clamp(pos - leg, 0, 1)) : null;
        const between = Math.abs(pos - Math.round(pos)) > 0.02;
        return (
          <>
            <svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible" }}>
              {pts.slice(1).map((b, k) => {
                const d = arc(pts[k]!, b);
                const drawn = clamp(pos - k, 0, 1);
                return (
                  <g key={k}>
                    <path d={d} fill="none" stroke={brand.text} strokeOpacity={0.28} strokeWidth={4 * u} strokeDasharray={`${10 * u} ${12 * u}`} strokeLinecap="round" />
                    {drawn > 0 && (
                      <path
                        d={d}
                        fill="none"
                        stroke={stopColor(k + 1)}
                        strokeWidth={7 * u}
                        strokeLinecap="round"
                        pathLength={1}
                        strokeDasharray="1 1"
                        strokeDashoffset={1 - drawn}
                        style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,.35))" }}
                      />
                    )}
                  </g>
                );
              })}
              {traveller && between && (
                <g>
                  <circle cx={traveller.x} cy={traveller.y} r={30 * u} fill={stopColor(leg + 1)} fillOpacity={0.25} />
                  <circle cx={traveller.x} cy={traveller.y} r={15 * u} fill={stopColor(leg + 1)} stroke="#fff" strokeWidth={5 * u} />
                </g>
              )}
            </svg>
            {stops.map((p, k) => (
              <Pin
                key={p.id}
                x={p.x}
                y={p.y}
                ctx={ctx}
                number={k + 1}
                big={k === step && !between}
                dim={k > pos + 0.01}
                color={stopColor(k)}
                label={k === step && !between ? p.title : undefined}
                onClick={() => {
                  goStep(k);
                  ctx.open(p);
                }}
              />
            ))}
          </>
        );
      }}
    </FittedImage>
  );

  if (stops.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: `0 ${110 * u}px ${64 * u}px` }}>
        <Empty ctx={ctx} text="Add stops to draw the journey." />
      </div>
    );
  }

  if (!app.dial) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 28 * u, padding: `0 ${110 * u}px ${64 * u}px` }}>
        {map}
        <div style={{ display: "flex", alignItems: "center", gap: 20 * u }}>
          {roundBtn(ICONS.prev, "Previous stop", () => goStep(step - 1), step === 0)}
          {stopCard(false)}
          {roundBtn(ICONS.next, "Next stop", () => goStep(step + 1), step >= last)}
          {roundBtn(playing ? ICONS.pause : ICONS.play, playing ? "Pause journey" : "Play journey", togglePlay, false, true)}
        </div>
      </div>
    );
  }

  const dialSize = (portrait ? 430 : 470) * u;
  const dial = (
    <JourneyDial
      ctx={ctx}
      count={stops.length}
      pos={pos}
      size={dialSize}
      colorOf={stopColor}
      title={cur?.title ?? ""}
      onTurn={(d) => {
        halt();
        setPlaying(false);
        setPos(posRef.current + d);
        poke.current();
      }}
      onRelease={() => glideTo(Math.round(posRef.current))}
      onPick={goStep}
      onCenter={() => cur && ctx.open(cur)}
      onStep={(dir) => goStep(Math.round(posRef.current) + dir)}
    />
  );
  const hint = (
    <div style={{ display: "flex", alignItems: "center", gap: 16 * u }}>
      {roundBtn(playing ? ICONS.pause : ICONS.play, playing ? "Pause journey" : "Play journey", togglePlay, false, true)}
      <span style={{ font: `500 ${20 * u}px/1.35 ${brand.bodyFont}`, color: brand.muted }}>Turn the dial to travel · tap the centre to read</span>
    </div>
  );

  return portrait ? (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 32 * u, padding: `0 ${110 * u}px ${64 * u}px` }}>
      {map}
      <div style={{ display: "flex", alignItems: "center", gap: 40 * u }}>
        {dial}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 24 * u }}>
          {stopCard(true)}
          {hint}
        </div>
      </div>
    </div>
  ) : (
    <div style={{ display: "flex", height: "100%", gap: 56 * u, padding: `0 ${110 * u}px ${64 * u}px` }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>{map}</div>
      <div style={{ width: dialSize, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: 28 * u }}>
        {dial}
        {stopCard(true)}
        {hint}
      </div>
    </div>
  );
}

/** Tappable areas drawn over the map; each glows until tapped, then opens its story. */
function RegionsMap({ app, ctx }: { app: Extract<StoryApp, { kind: "map" }>; ctx: Ctx }) {
  const { brand, u } = ctx;
  const [on, toggle] = useFilterSet();
  const [selected, setSelected] = useState<string | null>(null);
  const visible = app.regions.filter((g) => g.points.length >= 3 && (on.size === 0 || (g.filterId && on.has(g.filterId))));
  const colorOf = (filterId: string | null) => app.filters.find((f) => f.id === filterId)?.color ?? brand.accent;
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 32 * u, padding: `0 ${110 * u}px ${80 * u}px` }}>
      <Chips ctx={ctx} filters={app.filters} active={on} onToggle={toggle} allLabel="Everything" dots />
      <FittedImage url={app.mapUrl} ctx={ctx} grid>
        {(box) => (
          <>
            <svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} style={{ position: "absolute", inset: 0 }}>
              {visible.map((g, k) => {
                const c = colorOf(g.filterId);
                const sel = selected === g.id;
                return (
                  <polygon
                    key={g.id}
                    points={g.points.map((p) => `${(p.x / 100) * box.w},${(p.y / 100) * box.h}`).join(" ")}
                    fill={c}
                    fillOpacity={sel ? 0.6 : 0.3}
                    stroke={c}
                    strokeWidth={(sel ? 6 : 3) * u}
                    strokeLinejoin="round"
                    onClick={() => {
                      setSelected(g.id);
                      ctx.open(g);
                    }}
                    style={{
                      cursor: "pointer",
                      transition: "fill-opacity .3s, stroke-width .3s",
                      animation: sel ? undefined : `st-glow 3s ${k * 0.35}s ease-in-out infinite`,
                    }}
                  />
                );
              })}
            </svg>
            {visible.map((g) => {
              const cx = g.points.reduce((a, p) => a + p.x, 0) / g.points.length;
              const cy = g.points.reduce((a, p) => a + p.y, 0) / g.points.length;
              return (
                <span
                  key={g.id}
                  style={{
                    position: "absolute",
                    left: `${cx}%`,
                    top: `${cy}%`,
                    transform: "translate(-50%,-50%)",
                    pointerEvents: "none",
                    whiteSpace: "nowrap",
                    padding: `${8 * u}px ${18 * u}px`,
                    borderRadius: 999,
                    background: "rgba(10,10,14,.78)",
                    color: "#fff",
                    font: `600 ${22 * u}px ${brand.bodyFont}`,
                  }}
                >
                  {g.title}
                </span>
              );
            })}
          </>
        )}
      </FittedImage>
    </div>
  );
}

// ─── Video ────────────────────────────────────────────────────────────────────

/**
 * One chapter on the stage. The "master" track decides progress and the end:
 * the voice-over when there is one (the video, muted, loops under it), else the
 * video itself. A photo with a voice-over slowly zooms while it plays.
 */
function ChapterStage({ ch, ctx, captions, onEnded }: { ch: StoryVideoChapter; ctx: Ctx; captions: boolean; onEnded: () => void }) {
  const { brand, u } = ctx;
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const masterKind: "audio" | "video" | null = ch.voiceUrl ? "audio" : ch.videoUrl ? "video" : null;
  const master = () => (masterKind === "audio" ? audio.current : masterKind === "video" ? video.current : null);

  const play = useCallback(() => {
    const m = masterKind === "audio" ? audio.current : masterKind === "video" ? video.current : null;
    if (!m) return;
    // The viewer just tapped, so sound is allowed; if the browser still says
    // no, the big play button stays up for them to press.
    m.play().catch(() => setPlaying(false));
    if (masterKind === "audio") video.current?.play().catch(() => {});
  }, [masterKind]);

  const pause = () => {
    master()?.pause();
    if (masterKind === "audio") video.current?.pause();
  };

  useEffect(() => {
    play();
  }, [play]);

  const masterEvents = {
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onTimeUpdate: (e: React.SyntheticEvent<HTMLMediaElement>) => {
      const m = e.currentTarget;
      setProgress(m.duration ? m.currentTime / m.duration : 0);
      ctx.poke();
    },
    onEnded: () => {
      setPlaying(false);
      video.current?.pause();
      onEnded();
    },
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const m = master();
    if (!m || !m.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    m.currentTime = ((e.clientX - r.left) / r.width) * m.duration;
  };

  const fill: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%" };

  return (
    <div
      onClick={() => (playing ? pause() : play())}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", borderRadius: brand.radius * u, background: "#000", cursor: masterKind ? "pointer" : "default" }}
    >
      {ch.videoUrl ? (
        <video
          ref={video}
          src={ch.videoUrl}
          poster={ch.posterUrl ?? undefined}
          playsInline
          muted={!!ch.voiceUrl}
          loop={!!ch.voiceUrl}
          style={{ ...fill, objectFit: "contain" }}
          {...(masterKind === "video" ? masterEvents : {})}
        />
      ) : ch.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={ch.posterUrl}
          alt=""
          draggable={false}
          style={{
            ...fill,
            objectFit: "cover",
            animation: masterKind ? "st-kb 30s ease-out both" : undefined,
            animationPlayState: playing ? "running" : "paused",
          }}
        />
      ) : (
        <div style={{ ...fill, display: "flex", alignItems: "center", justifyContent: "center", padding: 80 * u, boxSizing: "border-box", background: `linear-gradient(135deg, ${brand.surface}, ${brand.background})` }}>
          <div style={{ textAlign: "center" }}>
            <Icon d={ICONS.video} size={90 * u} color={brand.accent} stroke={1.6} />
            <div style={{ marginTop: 24 * u, font: `700 ${56 * u}px/1.1 ${brand.headingFont}`, color: brand.text }}>{ch.title}</div>
            {!masterKind && ch.body && <div style={{ marginTop: 20 * u, font: `400 ${26 * u}px/1.5 ${brand.bodyFont}`, color: brand.muted, maxWidth: 1000 * u }}>{ch.body}</div>}
          </div>
        </div>
      )}
      {ch.voiceUrl && <audio ref={audio} src={ch.voiceUrl} {...masterEvents} />}

      {masterKind && !playing && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.25)" }}>
          <span style={{ width: 150 * u, height: 150 * u, borderRadius: 99, background: brand.accent, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 12px 40px rgba(0,0,0,.4)" }}>
            <Icon d={ICONS.play} size={64 * u} color={brand.accentText} />
          </span>
        </div>
      )}

      {captions && masterKind && ch.body && (
        <div
          style={{
            position: "absolute",
            left: 60 * u,
            right: 60 * u,
            bottom: 70 * u,
            maxHeight: "40%",
            overflow: "hidden",
            padding: `${20 * u}px ${30 * u}px`,
            borderRadius: 16 * u,
            background: "rgba(0,0,0,.72)",
            color: "#fff",
            font: `400 ${28 * u}px/1.45 ${brand.bodyFont}`,
            whiteSpace: "pre-wrap",
            textAlign: "center",
          }}
        >
          {ch.body}
        </div>
      )}

      {masterKind && (
        <div onClick={seek} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 36 * u, display: "flex", alignItems: "flex-end", cursor: "pointer" }}>
          <div style={{ width: "100%", height: 8 * u, background: "rgba(255,255,255,.25)" }}>
            <div style={{ width: `${progress * 100}%`, height: "100%", background: brand.accent, transition: "width .25s linear" }} />
          </div>
        </div>
      )}
    </div>
  );
}

function VideoView({ app, ctx }: { app: Extract<StoryApp, { kind: "video" }>; ctx: Ctx }) {
  const { brand, u, portrait } = ctx;
  const [i, setI] = useState(0);
  const [captions, setCaptions] = useState(true);
  const rail = useDragScroll<HTMLDivElement>();
  const chapters = app.chapters;
  const ch = chapters[Math.min(i, chapters.length - 1)];

  if (!ch) return <Empty ctx={ctx} text="No chapters yet." />;

  const next = () => {
    if (app.autoAdvance && i < chapters.length - 1) setI(i + 1);
  };

  return (
    <div style={{ display: "flex", flexDirection: portrait ? "column" : "row", height: "100%", gap: 36 * u, padding: `0 ${110 * u}px ${80 * u}px` }}>
      <div style={{ flex: portrait ? "0 0 auto" : 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", gap: 24 * u }}>
        <div style={{ position: "relative", width: "100%", aspectRatio: portrait ? "16 / 9" : undefined, flex: portrait ? undefined : 1, minHeight: 0 }}>
          <ChapterStage key={ch.id} ch={ch} ctx={ctx} captions={captions} onEnded={next} />
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 24 * u }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: `600 ${20 * u}px ${brand.bodyFont}`, color: brand.accent, textTransform: "uppercase", letterSpacing: "0.12em" }}>
              Chapter {i + 1} of {chapters.length}
              {ch.subtitle ? ` · ${ch.subtitle}` : ""}
            </div>
            <div style={{ marginTop: 8 * u, font: `700 ${40 * u}px/1.1 ${brand.headingFont}`, color: brand.text }}>{ch.title}</div>
          </div>
          {(ch.voiceUrl || ch.videoUrl) && ch.body && (
            <button
              type="button"
              className="st-tap"
              onClick={() => setCaptions((c) => !c)}
              aria-pressed={captions}
              style={{
                flexShrink: 0,
                height: 64 * u,
                padding: `0 ${26 * u}px`,
                borderRadius: 999,
                border: `${2 * u}px solid ${captions ? brand.accent : "rgba(127,127,127,.35)"}`,
                background: captions ? brand.accent : "transparent",
                color: captions ? brand.accentText : brand.text,
                font: `700 ${22 * u}px ${brand.bodyFont}`,
                cursor: "pointer",
              }}
            >
              CC {captions ? "On" : "Off"}
            </button>
          )}
        </div>
      </div>
      {chapters.length > 1 && (
        <div
          ref={rail}
          style={{
            flex: portrait ? 1 : `0 0 ${560 * u}px`,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 16 * u,
          }}
        >
          {chapters.map((c, k) => {
            const active = k === i;
            return (
              <button
                key={c.id}
                type="button"
                className="st-tap"
                onClick={() => setI(k)}
                style={{
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 22 * u,
                  padding: 14 * u,
                  borderRadius: brand.radius * u,
                  border: `${3 * u}px solid ${active ? brand.accent : "transparent"}`,
                  background: brand.surface,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <Cover url={c.posterUrl} ctx={ctx} kind="video" style={{ width: 170 * u, height: 100 * u, flexShrink: 0, borderRadius: Math.max(4, brand.radius * 0.6) * u }} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", font: `600 ${18 * u}px ${brand.bodyFont}`, color: active ? brand.accent : brand.muted, textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    {active ? "Now playing" : `Chapter ${k + 1}`}
                  </span>
                  <span style={{ display: "block", marginTop: 6 * u, font: `700 ${26 * u}px/1.2 ${brand.headingFont}`, color: brand.text }}>{c.title}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ShowcaseView({ app, ctx }: { app: Extract<StoryApp, { kind: "showcase" }>; ctx: Ctx }) {
  const { brand, u, portrait } = ctx;
  const [filter, setFilter] = useState<string | null>(null);
  const scroller = useDragScroll<HTMLDivElement>();
  const items = app.items.filter((i) => !filter || i.filterId === filter);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 36 * u, padding: `0 ${110 * u}px` }}>
      <Chips ctx={ctx} filters={app.filters} active={new Set(filter ? [filter] : [])} onToggle={setFilter} />
      {items.length === 0 ? (
        <Empty ctx={ctx} text="Nothing here yet." />
      ) : (
        <div
          ref={scroller}
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: `repeat(${portrait ? 2 : 4}, minmax(0, 1fr))`,
            gridAutoRows: `${(portrait ? 560 : 440) * u}px`,
            gap: 28 * u,
            paddingBottom: 80 * u,
          }}
        >
          {items.map((it, k) => (
            <button
              key={it.id}
              type="button"
              className="st-tap"
              onClick={() => ctx.open(it)}
              style={{
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
                border: "none",
                padding: 0,
                textAlign: "left",
                cursor: "pointer",
                borderRadius: brand.radius * u,
                background: brand.surface,
                animation: `st-pop .5s ${Math.min(k, 12) * 0.04}s ease both`,
              }}
            >
              <Cover url={it.coverUrl ?? it.media.find((m) => m.type === "image")?.url ?? null} ctx={ctx} style={{ flex: 1, width: "100%", minHeight: 0 }} />
              <div style={{ padding: `${22 * u}px ${26 * u}px ${26 * u}px` }}>
                <div style={{ font: `700 ${30 * u}px/1.15 ${brand.headingFont}`, color: brand.text }}>{it.title}</div>
                {it.subtitle && <div style={{ marginTop: 6 * u, font: `400 ${21 * u}px/1.35 ${brand.bodyFont}`, color: brand.muted }}>{it.subtitle}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HotspotView({ app, ctx }: { app: Extract<StoryApp, { kind: "hotspots" }>; ctx: Ctx }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: `0 ${110 * ctx.u}px ${80 * ctx.u}px` }}>
      <FittedImage url={app.imageUrl} ctx={ctx} grid>
        {() =>
          app.hotspots.map((h, k) => (
            <Pin key={h.id} x={h.x} y={h.y} ctx={ctx} color={ctx.brand.accent} number={k + 1} onClick={() => ctx.open(h)} />
          ))
        }
      </FittedImage>
    </div>
  );
}

function Empty({ ctx, text }: { ctx: Ctx; text: string }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: ctx.brand.muted, font: `400 ${30 * ctx.u}px ${ctx.brand.bodyFont}` }}>
      {text}
    </div>
  );
}

function AppScreen({ app, ctx, onHome }: { app: StoryApp; ctx: Ctx; onHome: () => void }) {
  const { brand, u } = ctx;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", animation: "st-fade .45s ease both" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 28 * u, padding: `${64 * u}px ${110 * u}px ${36 * u}px` }}>
        <button
          type="button"
          className="st-tap"
          onClick={onHome}
          aria-label="Home"
          style={{
            width: 84 * u,
            height: 84 * u,
            flexShrink: 0,
            borderRadius: 999,
            border: "none",
            background: brand.surface,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Icon d={ICONS.home} size={38 * u} color={brand.text} />
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ font: `700 ${60 * u}px/1.05 ${brand.headingFont}`, color: brand.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{app.title}</div>
          {app.tagline && <div style={{ marginTop: 6 * u, font: `400 ${26 * u}px ${brand.bodyFont}`, color: brand.muted }}>{app.tagline}</div>}
        </div>
        {brand.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt="" draggable={false} style={{ height: 64 * u, objectFit: "contain" }} />
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {app.kind === "timeline" && <TimelineView app={app} ctx={ctx} />}
        {app.kind === "map" && <MapView app={app} ctx={ctx} />}
        {app.kind === "showcase" && <ShowcaseView app={app} ctx={ctx} />}
        {app.kind === "hotspots" && <HotspotView app={app} ctx={ctx} />}
        {app.kind === "video" && <VideoView app={app} ctx={ctx} />}
      </div>
    </div>
  );
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function MediaSlide({ m, ctx, active }: { m: StoryMedia; ctx: Ctx; active: boolean }) {
  const fill: React.CSSProperties = { width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#000" };
  if (m.type === "video")
    return active ? <video src={m.url} autoPlay controls playsInline onTimeUpdate={ctx.poke} style={fill} /> : <div style={fill} />;
  if (m.type === "pdf")
    return active ? (
      <iframe src={`${m.url}#toolbar=0&navpanes=0`} title={m.name ?? "Document"} style={{ ...fill, border: "none", background: "#fff" }} />
    ) : (
      <div style={{ ...fill, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon d={ICONS.file} size={80 * ctx.u} color="#fff" />
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={m.url} alt="" draggable={false} style={fill} />;
}

function Lightbox({ detail, ctx, onClose }: { detail: StoryDetail; ctx: Ctx; onClose: () => void }) {
  const { brand, u, portrait } = ctx;
  const [i, setI] = useState(0);
  const body = useDragScroll<HTMLDivElement>();
  const media = detail.media;
  const hasMedia = media.length > 0;
  const navBtn = (dir: -1 | 1) => (
    <button
      type="button"
      className="st-tap"
      aria-label={dir < 0 ? "Previous" : "Next"}
      onClick={() => setI((x) => (x + dir + media.length) % media.length)}
      style={{
        position: "absolute",
        top: "50%",
        [dir < 0 ? "left" : "right"]: 20 * u,
        transform: "translateY(-50%)",
        width: 72 * u,
        height: 72 * u,
        borderRadius: 99,
        border: "none",
        background: "rgba(0,0,0,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      <Icon d={dir < 0 ? ICONS.left : ICONS.right} size={36 * u} color="#fff" />
    </button>
  );

  return (
    <div
      onClick={onClose}
      style={{ position: "absolute", inset: 0, zIndex: 20, background: "rgba(0,0,0,.66)", display: "flex", alignItems: "center", justifyContent: "center", animation: "st-fade .25s ease both" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          // With media: a large two-pane panel. Text only: sized to the copy.
          width: hasMedia ? (portrait ? "88%" : "84%") : portrait ? "84%" : "56%",
          height: hasMedia ? "80%" : undefined,
          maxHeight: "80%",
          display: "flex",
          flexDirection: portrait ? "column" : "row",
          overflow: "hidden",
          borderRadius: brand.radius * 1.4 * u,
          background: brand.surface,
          boxShadow: "0 30px 120px rgba(0,0,0,.55)",
          animation: "st-pop .35s ease both",
        }}
      >
        {hasMedia && (
          <div style={{ position: "relative", flex: portrait ? "0 0 48%" : "0 0 58%", background: "#000" }}>
            <MediaSlide key={media[i % media.length]!.id} m={media[i % media.length]!} ctx={ctx} active />
            {media.length > 1 && (
              <>
                {navBtn(-1)}
                {navBtn(1)}
                <div style={{ position: "absolute", bottom: 20 * u, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 10 * u }}>
                  {media.map((m, k) => (
                    <button
                      key={m.id}
                      type="button"
                      aria-label={`Item ${k + 1}`}
                      onClick={() => setI(k)}
                      style={{ width: k === i % media.length ? 34 * u : 12 * u, height: 12 * u, borderRadius: 99, border: "none", padding: 0, background: "#fff", opacity: k === i % media.length ? 1 : 0.45, cursor: "pointer" }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div ref={body} style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: "auto", padding: `${64 * u}px ${110 * u}px ${56 * u}px ${56 * u}px` }}>
          {detail.subtitle && (
            <div style={{ font: `600 ${22 * u}px ${brand.bodyFont}`, color: brand.accent, textTransform: "uppercase", letterSpacing: "0.12em" }}>{detail.subtitle}</div>
          )}
          <div style={{ marginTop: detail.subtitle ? 14 * u : 0, font: `700 ${56 * u}px/1.08 ${brand.headingFont}`, color: brand.text }}>{detail.title}</div>
          {detail.body && (
            <div style={{ marginTop: 28 * u, font: `400 ${28 * u}px/1.55 ${brand.bodyFont}`, color: brand.text, opacity: 0.86, whiteSpace: "pre-wrap" }}>{detail.body}</div>
          )}
        </div>
        <button
          type="button"
          className="st-tap"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: "absolute",
            top: 22 * u,
            right: 22 * u,
            width: 72 * u,
            height: 72 * u,
            borderRadius: 99,
            border: "none",
            background: "rgba(0,0,0,.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Icon d={ICONS.close} size={34 * u} color="#fff" />
        </button>
      </div>
    </div>
  );
}

// ─── Player ───────────────────────────────────────────────────────────────────

export interface StorySurfaceProps {
  content: StoryContent;
  /** Controlled view (the editor drives it); omit to let the viewer navigate. */
  view?: StoryView;
  onViewChange?: (v: StoryView) => void;
  /** Never fall back to the idle screen (editor). */
  disableIdle?: boolean;
  /** Thumbnails: no timers, no animation. */
  still?: boolean;
}

/** The story at native design size (callers scale it). */
export function StorySurface({ content, view: controlled, onViewChange, disableIdle, still }: StorySurfaceProps) {
  const startView: StoryView = content.idle.enabled && !disableIdle && !still ? { screen: "idle" } : { screen: "home" };
  const [own, setOwn] = useState<StoryView>(startView);
  const view = controlled ?? own;
  const [detail, setDetail] = useState<StoryDetail | null>(null);
  const portrait = content.height > content.width;
  const u = Math.min(content.width, content.height) / 1080;

  const go = useCallback(
    (v: StoryView) => {
      setDetail(null);
      if (onViewChange) onViewChange(v);
      if (!controlled) setOwn(v);
    },
    [controlled, onViewChange]
  );

  // Inactivity: back to the idle screen after the timeout with no touch.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!content.idle.enabled || disableIdle || still) return;
    timer.current = setTimeout(() => go({ screen: "idle" }), content.idle.timeoutSeconds * 1000);
  }, [content.idle.enabled, content.idle.timeoutSeconds, disableIdle, go, still]);
  useEffect(() => {
    if (view.screen !== "idle") arm();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [arm, view.screen]);

  // An app deleted (editor) or removed by a re-push — fall back home.
  const app = view.screen === "app" ? content.apps.find((a) => a.id === view.appId) : undefined;
  const screen = view.screen === "app" && !app ? "home" : view.screen;

  const ctx: Ctx = { brand: content.brand, u, portrait, open: setDetail, poke: arm };

  return (
    <div
      className="st-root"
      onPointerDownCapture={arm}
      style={{
        position: "relative",
        width: content.width,
        height: content.height,
        overflow: "hidden",
        background: content.brand.background,
        color: content.brand.text,
        fontFamily: content.brand.bodyFont,
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <style>{CSS}</style>
      {screen === "idle" && <IdleScreen content={content} ctx={ctx} onStart={() => go({ screen: "home" })} animate={!still} />}
      {screen === "home" && <HomeScreen content={content} ctx={ctx} onOpen={(id) => go({ screen: "app", appId: id })} animate={!still} />}
      {screen === "app" && app && <AppScreen key={app.id} app={app} ctx={ctx} onHome={() => go({ screen: "home" })} />}
      {detail && !still && <Lightbox detail={detail} ctx={ctx} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** Full-screen playback for displays and the preview tab. */
export function StoryPlayer({ content, onReady }: { content: StoryContent; onReady?: () => void }) {
  const ready = useRef(onReady);
  ready.current = onReady;
  useEffect(() => {
    ready.current?.();
  }, []);
  return (
    <ScreenStage width={content.width} height={content.height} variant="fit-screen">
      <StorySurface content={content} />
    </ScreenStage>
  );
}

/** Scales a StorySurface into whatever box the caller sizes (editor preview, thumbnails). */
export function StoryFrame({
  className,
  style,
  ...surface
}: StorySurfaceProps & { className?: string; style?: React.CSSProperties }) {
  const [ref, box] = useBoxSize<HTMLDivElement>();
  const { content } = surface;
  const scale = box.w && box.h ? Math.min(box.w / content.width, box.h / content.height) : 0;
  return (
    <div ref={ref} className={className} style={{ position: "relative", overflow: "hidden", ...style }}>
      {scale > 0 && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: content.width,
            height: content.height,
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: "center",
            pointerEvents: surface.still ? "none" : undefined,
          }}
        >
          <StorySurface {...surface} />
        </div>
      )}
    </div>
  );
}
