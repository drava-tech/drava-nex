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
} as const;

export const STORY_APP_ICON: Record<StoryAppKind, string> = {
  timeline: ICONS.timeline,
  map: ICONS.map,
  showcase: ICONS.showcase,
  hotspots: ICONS.hotspots,
};

// ─── Shared bits ──────────────────────────────────────────────────────────────

interface Ctx {
  brand: StoryBrand;
  /** Type scale unit: 1 at 1080 px on the short side. */
  u: number;
  portrait: boolean;
  open: (d: StoryDetail) => void;
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

function Pin({ x, y, color, label, onClick, ctx, number }: { x: number; y: number; color: string; label?: string; onClick: () => void; ctx: Ctx; number?: number }) {
  const { u, brand } = ctx;
  const d = (number !== undefined ? 52 : 34) * u;
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
      }}
    >
      <span style={{ position: "absolute", left: "50%", top: "50%", width: d, height: d, borderRadius: 99, background: color, animation: "st-pulse 2s ease-out infinite" }} />
      <span
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: d,
          height: d,
          transform: "translate(-50%,-50%)",
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

function MapView({ app, ctx }: { app: Extract<StoryApp, { kind: "map" }>; ctx: Ctx }) {
  const [on, setOn] = useState<Set<string>>(new Set());
  const toggle = (id: string | null) =>
    setOn((prev) => {
      if (id === null) return new Set();
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      </div>
    </div>
  );
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────

function MediaSlide({ m, ctx, active }: { m: StoryMedia; ctx: Ctx; active: boolean }) {
  const fill: React.CSSProperties = { width: "100%", height: "100%", objectFit: "contain", display: "block", background: "#000" };
  if (m.type === "video")
    return active ? <video src={m.url} autoPlay controls playsInline style={fill} /> : <div style={fill} />;
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

  const ctx: Ctx = { brand: content.brand, u, portrait, open: setDetail };

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
