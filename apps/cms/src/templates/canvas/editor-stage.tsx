"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CanvasElementBody,
  canvasBackgroundStyle,
  textStyle,
  type CanvasElement,
  type CanvasPage,
  type CanvasTextElement,
} from "@platform/ui/templates/canvas";
import {
  HANDLES,
  aabb,
  elementBoxes,
  intersects,
  resizeBox,
  snapBox,
  unionBox,
  type Box,
  type Guide,
  type Handle,
} from "./geometry";

type Updater = (elements: CanvasElement[]) => CanvasElement[];

interface EditorStageProps {
  width: number;
  height: number;
  page: CanvasPage;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  editingId: string | null;
  onEditText: (id: string | null) => void;
  /** 1 = fit to the available area. */
  zoom: number;
  update: (fn: Updater, opts?: { record?: boolean }) => void;
  begin: () => void;
  end: () => void;
}

type Drag =
  | {
      kind: "move";
      startX: number;
      startY: number;
      starts: Map<string, { x: number; y: number }>;
      box: Box;
      others: Box[];
      moved: boolean;
    }
  | { kind: "resize"; startX: number; startY: number; handle: Handle; el: CanvasElement }
  | { kind: "rotate"; cx: number; cy: number; startAngle: number; startRotation: number; id: string }
  | { kind: "marquee"; x0: number; y0: number; additive: string[] };

const SNAP_PX = 6;
const FIT_PADDING = 64;

export function EditorStage({
  width,
  height,
  page,
  selectedIds,
  onSelect,
  editingId,
  onEditText,
  zoom,
  update,
  begin,
  end,
}: EditorStageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [readout, setReadout] = useState<{ x: number; y: number; text: string } | null>(null);
  const drag = useRef<Drag | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const measure = () => {
      const s = Math.min(
        (node.clientWidth - FIT_PADDING * 2) / width,
        (node.clientHeight - FIT_PADDING * 2) / height
      );
      setFit(Math.max(0.02, s));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [width, height]);

  const scale = fit * zoom;

  const toDesign = useCallback(
    (clientX: number, clientY: number) => {
      const r = boardRef.current!.getBoundingClientRect();
      return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
    },
    [scale]
  );

  // ── Pointer lifecycle ────────────────────────────────────────────────────
  const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;

      if (d.kind === "marquee") {
        const p = toDesign(e.clientX, e.clientY);
        const box = {
          x: Math.min(d.x0, p.x),
          y: Math.min(d.y0, p.y),
          w: Math.abs(p.x - d.x0),
          h: Math.abs(p.y - d.y0),
        };
        setMarquee(box);
        const hit = pageRef.current.elements.filter((el) => intersects(aabb(el), box)).map((el) => el.id);
        onSelect(Array.from(new Set([...d.additive, ...hit])));
        return;
      }

      if (d.kind === "move") {
        let dx = (e.clientX - d.startX) / scale;
        let dy = (e.clientY - d.startY) / scale;
        if (!d.moved && Math.hypot(dx * scale, dy * scale) < 3) return;
        if (!d.moved) {
          d.moved = true;
          begin();
        }
        if (e.shiftKey) {
          // Constrain to the dominant axis.
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const moved = { ...d.box, x: d.box.x + dx, y: d.box.y + dy };
        const snap = e.altKey ? { dx: 0, dy: 0, guides: [] } : snapBox(moved, d.others, { width, height }, SNAP_PX / scale);
        dx += snap.dx;
        dy += snap.dy;
        setGuides(snap.guides);
        setReadout({ x: e.clientX, y: e.clientY, text: `${Math.round(d.box.x + dx)}, ${Math.round(d.box.y + dy)}` });
        update(
          (els) =>
            els.map((el) => {
              const s = d.starts.get(el.id);
              return s ? { ...el, x: s.x + dx, y: s.y + dy } : el;
            }),
          { record: false }
        );
        return;
      }

      if (d.kind === "resize") {
        const dx = (e.clientX - d.startX) / scale;
        const dy = (e.clientY - d.startY) / scale;
        const start = d.el;
        const keepRatio =
          start.type === "text" || start.type === "image" || start.type === "video" ? !e.shiftKey : e.shiftKey;
        const next = resizeBox(start, d.handle, dx, dy, keepRatio);
        setReadout({ x: e.clientX, y: e.clientY, text: `${Math.round(next.w)} × ${Math.round(next.h)}` });
        update(
          (els) =>
            els.map((el) => {
              if (el.id !== start.id) return el;
              if (start.type === "text") {
                // Corners scale the type (Canva-style); side handles reflow it.
                const corner = d.handle.hx !== 0 && d.handle.hy !== 0;
                return {
                  ...(el as CanvasTextElement),
                  x: next.x,
                  y: next.y,
                  w: next.w,
                  h: corner ? next.h : el.h,
                  fontSize: corner ? Math.max(4, Math.round(start.fontSize * next.scale)) : start.fontSize,
                };
              }
              return { ...el, x: next.x, y: next.y, w: next.w, h: next.h };
            }),
          { record: false }
        );
        return;
      }

      if (d.kind === "rotate") {
        const angle = (Math.atan2(e.clientY - d.cy, e.clientX - d.cx) * 180) / Math.PI;
        let rot = d.startRotation + (angle - d.startAngle);
        if (e.shiftKey) rot = Math.round(rot / 15) * 15;
        else {
          const near = Math.round(rot / 45) * 45;
          if (Math.abs(rot - near) < 4) rot = near;
        }
        rot = ((((rot + 180) % 360) + 360) % 360) - 180;
        setReadout({ x: e.clientX, y: e.clientY, text: `${Math.round(rot)}°` });
        update((els) => els.map((el) => (el.id === d.id ? { ...el, rotation: rot } : el)), { record: false });
      }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.up);
    setGuides([]);
    setMarquee(null);
    setReadout(null);
    if (!d) return;
    if (d.kind === "move" && !d.moved) return;
    if (d.kind !== "marquee") end();
  };

  // Window listeners are registered once per gesture; these stable wrappers
  // always call the latest handlers, so a re-render mid-drag (every frame
  // re-renders) can never strand a listener that removeEventListener misses.
  const moveRef = useRef(onMove);
  moveRef.current = onMove;
  const upRef = useRef(onUp);
  upRef.current = onUp;
  const [listeners] = useState(() => ({
    move: (e: PointerEvent) => moveRef.current(e),
    up: () => upRef.current(),
  }));

  const startDrag = (d: Drag) => {
    drag.current = d;
    window.addEventListener("pointermove", listeners.move);
    window.addEventListener("pointerup", listeners.up);
  };

  useEffect(
    () => () => {
      window.removeEventListener("pointermove", listeners.move);
      window.removeEventListener("pointerup", listeners.up);
    },
    [listeners]
  );

  const onElementDown = (e: React.PointerEvent, el: CanvasElement) => {
    if (e.button !== 0 || editingId === el.id) return;
    e.stopPropagation();
    let ids = selectedIds;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      ids = ids.includes(el.id) ? ids.filter((i) => i !== el.id) : [...ids, el.id];
      onSelect(ids);
      return;
    }
    if (!ids.includes(el.id)) {
      ids = [el.id];
      onSelect(ids);
    }
    if (editingId) onEditText(null);
    const movable = page.elements.filter((x) => ids.includes(x.id) && !x.locked);
    if (movable.length === 0) return;
    const exclude = new Set(ids);
    startDrag({
      kind: "move",
      startX: e.clientX,
      startY: e.clientY,
      starts: new Map(movable.map((x) => [x.id, { x: x.x, y: x.y }])),
      box: unionBox(movable.map((x) => aabb(x)))!,
      others: elementBoxes(page.elements, exclude),
      moved: false,
    });
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (editingId) onEditText(null);
    const additive = e.shiftKey ? selectedIds : [];
    onSelect(additive);
    const p = toDesign(e.clientX, e.clientY);
    startDrag({ kind: "marquee", x0: p.x, y0: p.y, additive });
  };

  const selected = page.elements.filter((el) => selectedIds.includes(el.id));
  const single = selected.length === 1 ? selected[0]! : null;

  const onHandleDown = (e: React.PointerEvent, handle: Handle) => {
    if (!single) return;
    e.stopPropagation();
    begin();
    startDrag({ kind: "resize", startX: e.clientX, startY: e.clientY, handle, el: single });
  };

  const onRotateDown = (e: React.PointerEvent) => {
    if (!single) return;
    e.stopPropagation();
    const r = boardRef.current!.getBoundingClientRect();
    const cx = r.left + (single.x + single.w / 2) * scale;
    const cy = r.top + (single.y + single.h / 2) * scale;
    begin();
    startDrag({
      kind: "rotate",
      cx,
      cy,
      id: single.id,
      startRotation: single.rotation,
      startAngle: (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI,
    });
  };

  // Text boxes size their own height to the text (like Canva) — measured in
  // design px (offsetHeight ignores the CSS scale) and written back without
  // an undo step.
  const onMeasure = useCallback(
    (id: string, h: number) => {
      update(
        (els) => els.map((el) => (el.id === id && el.type === "text" && Math.abs(el.h - h) > 0.5 ? { ...el, h } : el)),
        { record: false }
      );
    },
    [update]
  );

  return (
    <div
      ref={viewportRef}
      className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-zinc-200/70 dark:bg-zinc-900"
      // Dragging must never start a native text selection (the blue wash
      // across every text box); the inline text editor opts back in.
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          if (editingId) onEditText(null);
          onSelect([]);
        }
      }}
    >
      <div
        className="flex min-h-full min-w-full items-center justify-center"
        style={{ padding: FIT_PADDING, width: "max-content", height: "max-content" }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            if (editingId) onEditText(null);
            onSelect([]);
          }
        }}
      >
        {fit > 0 && (
          <div
            ref={boardRef}
            className="relative shrink-0 shadow-[0_8px_40px_rgba(0,0,0,0.25)]"
            style={{ width: width * scale, height: height * scale }}
          >
            {/* Design surface at native size, scaled. */}
            <div
              onPointerDown={onBackgroundDown}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width,
                height,
                transform: `scale(${scale})`,
                transformOrigin: "0 0",
                overflow: "hidden",
                ...canvasBackgroundStyle(page.background),
              }}
            >
              {page.elements.map((el) => (
                <StageElement
                  key={el.id}
                  el={el}
                  editing={editingId === el.id}
                  onPointerDown={(e) => onElementDown(e, el)}
                  onDoubleClick={() => {
                    if (el.type === "text" && !el.locked) {
                      onSelect([el.id]);
                      onEditText(el.id);
                    }
                  }}
                  onHover={(on) => setHoverId(on ? el.id : null)}
                  onMeasure={onMeasure}
                  onCommitText={(text) => {
                    update((els) => els.map((x) => (x.id === el.id && x.type === "text" ? { ...x, text } : x)));
                    onEditText(null);
                  }}
                />
              ))}
            </div>

            {/* Overlay in screen px, so handles stay the same size at any zoom. */}
            <div className="pointer-events-none absolute inset-0">
              {hoverId && !selectedIds.includes(hoverId) && (
                <Outline el={page.elements.find((x) => x.id === hoverId)} scale={scale} />
              )}
              {selected.length > 1 &&
                selected.map((el) => <Outline key={el.id} el={el} scale={scale} />)}
              {selected.length > 1 && (() => {
                const u = unionBox(selected.map((x) => aabb(x)))!;
                return (
                  <div
                    className="absolute border border-dashed border-violet-500"
                    style={{ left: u.x * scale, top: u.y * scale, width: u.w * scale, height: u.h * scale }}
                  />
                );
              })()}
              {single && !editingId && (
                <SelectionFrame
                  el={single}
                  scale={scale}
                  onHandleDown={onHandleDown}
                  onRotateDown={onRotateDown}
                />
              )}
              {guides.map((g, i) =>
                g.axis === "x" ? (
                  <div key={i} className="absolute top-0 bottom-0 w-px bg-pink-500" style={{ left: g.at * scale }} />
                ) : (
                  <div key={i} className="absolute left-0 right-0 h-px bg-pink-500" style={{ top: g.at * scale }} />
                )
              )}
              {marquee && (
                <div
                  className="absolute border border-violet-500 bg-violet-500/10"
                  style={{
                    left: marquee.x * scale,
                    top: marquee.y * scale,
                    width: marquee.w * scale,
                    height: marquee.h * scale,
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
      {readout && (
        <div
          className="pointer-events-none fixed z-50 rounded-md bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white shadow"
          style={{ left: readout.x + 14, top: readout.y + 18 }}
        >
          {readout.text}
        </div>
      )}
    </div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function StageElement({
  el,
  editing,
  onPointerDown,
  onDoubleClick,
  onHover,
  onMeasure,
  onCommitText,
}: {
  el: CanvasElement;
  editing: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onDoubleClick: () => void;
  onHover: (on: boolean) => void;
  onMeasure: (id: string, h: number) => void;
  onCommitText: (text: string) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const isText = el.type === "text";

  useLayoutEffect(() => {
    if (!isText) return;
    const node = bodyRef.current;
    if (!node) return;
    const measure = () => onMeasure(el.id, node.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [isText, el.id, onMeasure]);

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      style={{
        position: "absolute",
        left: el.x,
        top: el.y,
        width: el.w,
        height: isText ? undefined : el.h,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        opacity: el.opacity,
        cursor: el.locked ? "default" : editing ? "text" : "move",
      }}
    >
      <div ref={bodyRef} style={{ width: "100%", height: isText ? undefined : "100%" }}>
        {editing && el.type === "text" ? (
          <InlineTextEditor el={el} onCommit={onCommitText} />
        ) : (
          <CanvasElementBody el={el} />
        )}
      </div>
    </div>
  );
}

function InlineTextEditor({ el, onCommit }: { el: CanvasTextElement; onCommit: (text: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const committed = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.innerText = el.text;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // Mount-only: the editor owns the DOM text while it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    onCommit((ref.current?.innerText ?? el.text).replace(/\n$/, ""));
  };

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          commit();
        }
      }}
      style={{ ...textStyle(el), outline: "none", cursor: "text", caretColor: el.color, userSelect: "text", WebkitUserSelect: "text" }}
    />
  );
}

function Outline({ el, scale }: { el?: CanvasElement; scale: number }) {
  if (!el) return null;
  return (
    <div
      className="absolute border border-violet-400"
      style={{
        left: el.x * scale,
        top: el.y * scale,
        width: el.w * scale,
        height: el.h * scale,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
      }}
    />
  );
}

function SelectionFrame({
  el,
  scale,
  onHandleDown,
  onRotateDown,
}: {
  el: CanvasElement;
  scale: number;
  onHandleDown: (e: React.PointerEvent, h: Handle) => void;
  onRotateDown: (e: React.PointerEvent) => void;
}) {
  const w = el.w * scale;
  const h = el.h * scale;
  // Text: no top/bottom handles (its height follows the text).
  const handles = HANDLES.filter((hd) => !(el.type === "text" && hd.hx === 0));
  return (
    <div
      className="absolute border-2 border-violet-500"
      style={{
        left: el.x * scale,
        top: el.y * scale,
        width: w,
        height: h,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
      }}
    >
      {!el.locked &&
        handles.map((hd) => {
          const side = hd.hx === 0 || hd.hy === 0;
          const hw = side ? (hd.hx === 0 ? 22 : 8) : 13;
          const hh = side ? (hd.hy === 0 ? 22 : 8) : 13;
          return (
            <div
              key={hd.id}
              onPointerDown={(e) => onHandleDown(e, hd)}
              className="pointer-events-auto absolute rounded-full border border-zinc-300 bg-white shadow-sm"
              style={{
                width: hw,
                height: hh,
                left: ((hd.hx + 1) / 2) * w - hw / 2 - 1,
                top: ((hd.hy + 1) / 2) * h - hh / 2 - 1,
                cursor: hd.cursor,
              }}
            />
          );
        })}
      {!el.locked && (
        <div
          onPointerDown={onRotateDown}
          title="Rotate (Shift snaps to 15°)"
          className="pointer-events-auto absolute flex h-6 w-6 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 shadow-sm"
          style={{ left: w / 2 - 12, top: h + 18, cursor: "grab" }}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.2}>
            <path d="M21 12a9 9 0 1 1-3-6.7" strokeLinecap="round" />
            <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      {el.locked && (
        <div className="absolute -top-6 left-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-white">Locked</div>
      )}
    </div>
  );
}
