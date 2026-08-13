"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, Eraser, Eye, Minus, Moon, Palette, Pencil, Square, Sun, Trash2, Undo2, X } from "lucide-react";
import { cn } from "@platform/ui";
import {
  drawWhiteboardStroke,
  normalizedPointFromClient,
  whiteboardSurfaceClassName,
  WHITEBOARD_COLORS,
  WHITEBOARD_WIDTHS,
  type WhiteboardPoint,
  type WhiteboardStroke,
  type WhiteboardSurface,
  type WhiteboardTool,
} from "@/lib/whiteboard-canvas";
import {
  createWhiteboardSenderId,
  WHITEBOARD_CLEAR,
  WHITEBOARD_STOP,
  WHITEBOARD_STROKE_BEGIN,
  WHITEBOARD_STROKE_END,
  WHITEBOARD_STROKE_POINT,
  WHITEBOARD_SURFACE,
  WHITEBOARD_SYNC,
  WHITEBOARD_UNDO,
} from "@/lib/whiteboard-protocol";
import { applyWhiteboardCommand, initialWhiteboardSyncState, type WhiteboardSyncState } from "@/lib/whiteboard-sync";

const TOOLS: { id: WhiteboardTool; label: string; icon: typeof Pencil }[] = [
  { id: "pen", label: "Pen", icon: Pencil },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "line", label: "Line", icon: Minus },
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "circle", label: "Ellipse", icon: Circle },
];

/** Same three surfaces, same order, as the CMS toolbar's SURFACES. */
const SURFACES: { id: WhiteboardSurface; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "White board", icon: Sun },
  { id: "dark", label: "Dark board", icon: Moon },
  { id: "clear", label: "Annotate the page", icon: Eye },
];

/** Default style for strokes drawn by touching the TV directly, until the CMS toolbar (WHITEBOARD_SET_STYLE) says otherwise. */
const DEFAULT_STYLE: { tool: WhiteboardTool; color: string; width: number } = {
  tool: "pen",
  color: "#ef4444",
  width: WHITEBOARD_WIDTHS[1]!,
};

interface WhiteboardScreenOverlayProps {
  /** Relay a local interaction to every other client of this screen — same connection LiveScreenPlayer already holds. */
  sendInteraction: (command: string, value?: unknown) => void;
}

/**
 * Full-bleed canvas layered on top of (and, while active, visually replacing
 * via a solid backdrop) whatever ContentRenderer is showing. Bidirectional:
 * driven by `whiteboard-*` window events dispatched from LiveScreenPlayer's
 * handleCommand (strokes the CMS operator drew), AND lets touching the TV
 * itself draw, relaying those strokes back out over the same channel so the
 * CMS board and any other viewer stay in sync.
 */
export function WhiteboardScreenOverlay({ sendInteraction }: WhiteboardScreenOverlayProps) {
  const [visible, setVisible] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<WhiteboardSyncState>(initialWhiteboardSyncState());
  const [surface, setSurface] = useState(stateRef.current.surface);
  /** Mirrors stateRef.current.strokes.length — stateRef itself is a ref, so this is what drives the Undo/Clear disabled state. */
  const [strokeCount, setStrokeCount] = useState(0);
  const senderIdRef = useRef(createWhiteboardSenderId());
  const localStrokeRef = useRef<WhiteboardStroke | null>(null);
  // Real state (not a ref) so the on-screen toolbar below can highlight the
  // active tool/colour and react to style pushed from the CMS toolbar.
  const [localTool, setLocalTool] = useState<WhiteboardTool>(DEFAULT_STYLE.tool);
  const [localColor, setLocalColor] = useState(DEFAULT_STYLE.color);
  const [localWidth, setLocalWidth] = useState(DEFAULT_STYLE.width);
  const [showColors, setShowColors] = useState(false);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const stroke of stateRef.current.strokes) drawWhiteboardStroke(ctx, stroke, w, h);
    if (stateRef.current.current) drawWhiteboardStroke(ctx, stateRef.current.current, w, h);
    if (localStrokeRef.current) drawWhiteboardStroke(ctx, localStrokeRef.current, w, h);
  }, []);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }, [redraw]);

  useEffect(() => {
    if (!visible) return;
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [visible, resizeCanvas]);

  // Apply an incoming command from the shared channel — skip our own echo.
  const applyIncoming = useCallback(
    (command: string, value: any) => {
      if (value?.senderId === senderIdRef.current) return;
      stateRef.current = applyWhiteboardCommand(stateRef.current, command, value);
      setSurface(stateRef.current.surface);
      setStrokeCount(stateRef.current.strokes.length);
      redraw();
    },
    [redraw]
  );

  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent<any>).detail;
      stateRef.current = initialWhiteboardSyncState(detail?.surface ?? "light");
      localStrokeRef.current = null;
      setSurface(stateRef.current.surface);
      setStrokeCount(0);
      setVisible(true);
      redraw();
    };
    const onStop = (e: Event) => {
      const detail = (e as CustomEvent<any>).detail;
      if (detail?.senderId === senderIdRef.current) return;
      stateRef.current = initialWhiteboardSyncState();
      localStrokeRef.current = null;
      setStrokeCount(0);
      setVisible(false);
    };
    const onSync = (e: Event) => applyIncoming(WHITEBOARD_SYNC, (e as CustomEvent<any>).detail);
    const onSurface = (e: Event) => applyIncoming(WHITEBOARD_SURFACE, (e as CustomEvent<any>).detail);
    const onSetStyle = (e: Event) => {
      const detail = (e as CustomEvent<any>).detail;
      if (detail?.senderId === senderIdRef.current) return;
      setLocalTool(detail.tool);
      setLocalColor(detail.color);
      setLocalWidth(detail.width);
    };
    const onStrokeBegin = (e: Event) => applyIncoming(WHITEBOARD_STROKE_BEGIN, (e as CustomEvent<any>).detail);
    const onStrokePoint = (e: Event) => applyIncoming(WHITEBOARD_STROKE_POINT, (e as CustomEvent<any>).detail);
    const onStrokeEnd = (e: Event) => applyIncoming(WHITEBOARD_STROKE_END, (e as CustomEvent<any>).detail);
    const onUndo = (e: Event) => applyIncoming(WHITEBOARD_UNDO, (e as CustomEvent<any>).detail);
    const onClear = (e: Event) => applyIncoming(WHITEBOARD_CLEAR, (e as CustomEvent<any>).detail);

    window.addEventListener("whiteboard-start", onStart);
    window.addEventListener("whiteboard-stop", onStop);
    window.addEventListener("whiteboard-sync", onSync);
    window.addEventListener("whiteboard-surface", onSurface);
    window.addEventListener("whiteboard-set-style", onSetStyle);
    window.addEventListener("whiteboard-stroke-begin", onStrokeBegin);
    window.addEventListener("whiteboard-stroke-point", onStrokePoint);
    window.addEventListener("whiteboard-stroke-end", onStrokeEnd);
    window.addEventListener("whiteboard-undo", onUndo);
    window.addEventListener("whiteboard-clear", onClear);
    return () => {
      window.removeEventListener("whiteboard-start", onStart);
      window.removeEventListener("whiteboard-stop", onStop);
      window.removeEventListener("whiteboard-sync", onSync);
      window.removeEventListener("whiteboard-surface", onSurface);
      window.removeEventListener("whiteboard-set-style", onSetStyle);
      window.removeEventListener("whiteboard-stroke-begin", onStrokeBegin);
      window.removeEventListener("whiteboard-stroke-point", onStrokePoint);
      window.removeEventListener("whiteboard-stroke-end", onStrokeEnd);
      window.removeEventListener("whiteboard-undo", onUndo);
      window.removeEventListener("whiteboard-clear", onClear);
    };
  }, [applyIncoming, redraw]);

  // --- Touch the TV itself to draw — mirrors whiteboard-overlay.tsx's pointer handlers,
  // fixed to a single pen style since the TV has no tool picker.

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): WhiteboardPoint =>
    normalizedPointFromClient(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());

  const send = (command: string, payload?: Record<string, unknown>) =>
    sendInteraction(command, { senderId: senderIdRef.current, ...payload });

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const point = pointFromEvent(e);
    // An eraser you can't see the edge of is unusable — give it some bulk, same as the CMS toolbar.
    const width = localTool === "eraser" ? localWidth * 4 : localWidth;
    localStrokeRef.current = { tool: localTool, color: localColor, width, points: [point] };
    redraw();
    send(WHITEBOARD_STROKE_BEGIN, { tool: localTool, color: localColor, width, point });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = localStrokeRef.current;
    if (!stroke) return;
    const point = pointFromEvent(e);
    if (stroke.tool === "pen" || stroke.tool === "eraser") {
      stroke.points.push(point);
    } else {
      // Shapes only ever need start + latest point for the live preview.
      stroke.points[1] = point;
    }
    redraw();
    send(WHITEBOARD_STROKE_POINT, { point });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!localStrokeRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    stateRef.current = { ...stateRef.current, strokes: [...stateRef.current.strokes, localStrokeRef.current] };
    localStrokeRef.current = null;
    setStrokeCount(stateRef.current.strokes.length);
    redraw();
    send(WHITEBOARD_STROKE_END);
  };

  // --- On-screen touch controls — lets whoever's at the TV drive it directly,
  // not just receive strokes from the CMS.

  const selectTool = (t: WhiteboardTool) => setLocalTool(t);

  const selectColor = (c: string) => {
    setLocalColor(c);
    setShowColors(false);
    if (localTool === "eraser") setLocalTool("pen");
  };

  const handleLocalSurfaceToggle = () => {
    const index = SURFACES.findIndex((s) => s.id === surface);
    const next = SURFACES[(index + 1) % SURFACES.length]!.id;
    stateRef.current = { ...stateRef.current, surface: next };
    setSurface(next);
    send(WHITEBOARD_SURFACE, { surface: next });
  };

  const handleLocalUndo = () => {
    stateRef.current = { ...stateRef.current, strokes: stateRef.current.strokes.slice(0, -1) };
    setStrokeCount(stateRef.current.strokes.length);
    redraw();
    send(WHITEBOARD_UNDO);
  };

  const handleLocalClear = () => {
    stateRef.current = { ...stateRef.current, strokes: [], current: null };
    localStrokeRef.current = null;
    setStrokeCount(0);
    redraw();
    send(WHITEBOARD_CLEAR);
  };

  const handleLocalStop = () => {
    send(WHITEBOARD_STOP);
    stateRef.current = initialWhiteboardSyncState();
    localStrokeRef.current = null;
    setStrokeCount(0);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className={cn("fixed inset-0 z-40", whiteboardSurfaceClassName(surface))}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-4 sm:p-6">
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-black/60 p-2 shadow-2xl backdrop-blur-xl">
          {TOOLS.map((t) => (
            <TvToolbarButton key={t.id} label={t.label} active={localTool === t.id} onClick={() => selectTool(t.id)}>
              <t.icon className="h-5 w-5" />
            </TvToolbarButton>
          ))}

          <span className="mx-1 h-8 w-px shrink-0 bg-white/15" />

          {/* Same swatch popup as the CMS toolbar, not a bare native colour
              input — same WHITEBOARD_COLORS palette either side. */}
          <div className="relative">
            <TvToolbarButton label="Colour" active={showColors} onClick={() => setShowColors((v) => !v)}>
              <span className="relative flex h-5 w-5 items-center justify-center">
                <Palette className="h-5 w-5" />
                <span
                  className="absolute -bottom-1.5 h-1 w-5 rounded-full ring-1 ring-white/30"
                  style={{ backgroundColor: localColor }}
                />
              </span>
            </TvToolbarButton>

            {showColors && (
              <div className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-white/10 bg-black/80 p-2 shadow-xl backdrop-blur-xl">
                {WHITEBOARD_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => selectColor(c)}
                    aria-label={`Colour ${c}`}
                    className={cn(
                      "h-7 w-7 shrink-0 rounded-full ring-1 ring-white/20 transition-transform hover:scale-110",
                      localColor === c && "ring-2 ring-blue-500 ring-offset-2 ring-offset-black"
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <label
                  className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full ring-1 ring-white/20"
                  style={{ background: "conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)" }}
                  title="Custom colour"
                >
                  <input
                    type="color"
                    value={localColor}
                    onChange={(e) => selectColor(e.target.value)}
                    className="h-0 w-0 opacity-0"
                  />
                </label>
              </div>
            )}
          </div>

          <span className="mx-1 h-8 w-px shrink-0 bg-white/15" />

          {WHITEBOARD_WIDTHS.map((w) => (
            <TvToolbarButton key={w} label={`${w}px`} active={localWidth === w} onClick={() => setLocalWidth(w)}>
              <span className="rounded-full bg-current" style={{ width: Math.min(w + 4, 20), height: Math.min(w + 4, 20) }} />
            </TvToolbarButton>
          ))}

          <span className="mx-1 h-8 w-px shrink-0 bg-white/15" />

          <TvToolbarButton
            label={`Board: ${SURFACES.find((s) => s.id === surface)?.label ?? "White board"}`}
            onClick={handleLocalSurfaceToggle}
          >
            {(() => {
              const ActiveIcon = SURFACES.find((s) => s.id === surface)?.icon ?? Sun;
              return <ActiveIcon className="h-5 w-5" />;
            })()}
          </TvToolbarButton>

          <TvToolbarButton label="Undo" onClick={handleLocalUndo} disabled={strokeCount === 0}>
            <Undo2 className="h-5 w-5" />
          </TvToolbarButton>
          <TvToolbarButton label="Clear" onClick={handleLocalClear} disabled={strokeCount === 0} danger>
            <Trash2 className="h-5 w-5" />
          </TvToolbarButton>

          <span className="mx-1 h-8 w-px shrink-0 bg-white/15" />

          <TvToolbarButton label="Exit whiteboard" onClick={handleLocalStop} danger>
            <X className="h-5 w-5" />
          </TvToolbarButton>
        </div>
      </div>
    </div>
  );
}

function TvToolbarButton({
  children,
  label,
  active,
  danger,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-30",
        active ? "bg-blue-600 text-white" : danger ? "text-red-400 hover:bg-red-500/10" : "text-white/80 hover:bg-white/10"
      )}
    >
      {children}
    </button>
  );
}
