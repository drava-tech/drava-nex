"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pencil,
  Eraser,
  Square,
  Circle,
  Minus,
  Undo2,
  Trash2,
  X,
  Palette,
  Sun,
  Moon,
  Eye,
  Link as LinkIcon,
} from "lucide-react";
import { FabMenu } from "@/components/fab-menu";
import type { FabMenuItem } from "@/components/fab-menu";
import { AddLinkDialog } from "@/app/(dashboard)/media/_components/add-link-dialog";
import { MediaPreviewModal, type MediaItem } from "@/app/(dashboard)/media/_components/media-preview-modal";

type Tool = "pen" | "eraser" | "line" | "rect" | "circle";
type Surface = "light" | "dark" | "clear";

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  tool: Tool;
  color: string;
  width: number;
  /** Freehand keeps every point; shapes only need start and end. */
  points: Point[];
}

const TOOLS: { id: Tool; label: string; icon: typeof Pencil }[] = [
  { id: "pen", label: "Pen", icon: Pencil },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "line", label: "Line", icon: Minus },
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "circle", label: "Ellipse", icon: Circle },
];

const COLORS = ["#18181b", "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7", "#ffffff"];
const WIDTHS = [2, 4, 8, 16];

const SURFACES: { id: Surface; label: string; icon: typeof Sun; className: string }[] = [
  { id: "light", label: "White board", icon: Sun, className: "bg-white" },
  { id: "dark", label: "Dark board", icon: Moon, className: "bg-[#101014]" },
  { id: "clear", label: "Annotate the page", icon: Eye, className: "bg-transparent" },
];

function applyStrokeStyle(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.width;
  if (stroke.tool === "eraser") {
    // Punch through what's already drawn rather than painting over it, so the
    // eraser works whatever the board colour is.
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = "#000";
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = stroke.color;
  }
}

/** Draw a whole stroke — used for replays (undo, resize) and shape previews. */
function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  const start = stroke.points[0];
  if (!start) return;
  const end = stroke.points[stroke.points.length - 1] ?? start;

  ctx.save();
  applyStrokeStyle(ctx, stroke);
  ctx.beginPath();

  switch (stroke.tool) {
    case "pen":
    case "eraser": {
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < stroke.points.length; i++) {
        const point = stroke.points[i];
        if (point) ctx.lineTo(point.x, point.y);
      }
      // A single tap should still leave a dot.
      if (stroke.points.length === 1) ctx.lineTo(start.x + 0.01, start.y);
      ctx.stroke();
      break;
    }
    case "line": {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      break;
    }
    case "rect": {
      ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
      break;
    }
    case "circle": {
      ctx.ellipse(
        (start.x + end.x) / 2,
        (start.y + end.y) / 2,
        Math.abs(end.x - start.x) / 2,
        Math.abs(end.y - start.y) / 2,
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

/**
 * Floating whiteboard + speed dial. A "+" FAB in the bottom-right corner opens
 * a menu with "Draw" (a full-screen drawing surface with a tool bar along the
 * bottom) and "Add Link" (push an existing Media Library item to a screen).
 *
 * Strokes are kept as objects and replayed rather than being flattened into
 * pixels — that's what makes undo and window resizing work at all.
 */
export function WhiteboardOverlay() {
  const [open, setOpen] = useState(false);
  const [showAddLink, setShowAddLink] = useState(false);
  const [previewItem, setPreviewItem] = useState<MediaItem | null>(null);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(COLORS[0] as string);
  const [width, setWidth] = useState<number>(4);
  const [surface, setSurface] = useState<Surface>("light");
  const [showColors, setShowColors] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);

  const boardRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const currentRef = useRef<Stroke | null>(null);

  const fabItems: FabMenuItem[] = [
    { id: "draw", label: "Draw", icon: <Pencil />, onClick: () => setOpen(true) },
    { id: "link", label: "Add Link", icon: <LinkIcon />, onClick: () => setShowAddLink(true) },
  ];

  // --- Canvas ---------------------------------------------------------------

  const contexts = useCallback(() => {
    const board = boardRef.current?.getContext("2d") ?? null;
    const preview = previewRef.current?.getContext("2d") ?? null;
    return { board, preview };
  }, []);

  const redraw = useCallback(() => {
    const canvas = boardRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke);
  }, []);

  /** Size both layers to the viewport in device pixels, then replay the strokes. */
  const resizeCanvases = useCallback(() => {
    const dpr = window.devicePixelRatio || 1;
    for (const canvas of [boardRef.current, previewRef.current]) {
      if (!canvas) continue;
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    redraw();
  }, [redraw]);

  useEffect(() => {
    if (!open) return;
    resizeCanvases();
    window.addEventListener("resize", resizeCanvases);
    return () => window.removeEventListener("resize", resizeCanvases);
  }, [open, resizeCanvases]);

  // Escape closes the board, but only once it's finished a stroke.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !currentRef.current) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);

    const stroke: Stroke = {
      tool,
      color,
      // An eraser you can't see the edge of is unusable — give it some bulk.
      width: tool === "eraser" ? width * 4 : width,
      points: [pointFromEvent(e)],
    };
    currentRef.current = stroke;

    // Freehand and erasing paint straight onto the board as they go; shapes are
    // rubber-banded on the preview layer until released.
    if (tool === "pen" || tool === "eraser") {
      const { board } = contexts();
      if (board) drawStroke(board, stroke);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = currentRef.current;
    if (!stroke) return;
    const point = pointFromEvent(e);
    const { board, preview } = contexts();

    if (stroke.tool === "pen" || stroke.tool === "eraser") {
      const previous = stroke.points[stroke.points.length - 1];
      stroke.points.push(point);
      if (board && previous) {
        board.save();
        applyStrokeStyle(board, stroke);
        board.beginPath();
        board.moveTo(previous.x, previous.y);
        board.lineTo(point.x, point.y);
        board.stroke();
        board.restore();
      }
      return;
    }

    // Shape: keep exactly two points and re-render the preview each frame.
    stroke.points[1] = point;
    if (preview) {
      // In CSS pixels — the context carries a devicePixelRatio transform.
      preview.clearRect(0, 0, window.innerWidth, window.innerHeight);
      drawStroke(preview, stroke);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = currentRef.current;
    if (!stroke) return;
    currentRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);

    const { board, preview } = contexts();
    if (stroke.tool !== "pen" && stroke.tool !== "eraser") {
      preview?.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (board) drawStroke(board, stroke);
    }

    strokesRef.current.push(stroke);
    setStrokeCount(strokesRef.current.length);
  };

  const handleUndo = () => {
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    redraw();
  };

  const handleClear = () => {
    strokesRef.current = [];
    setStrokeCount(0);
    redraw();
  };

  const activeSurface = SURFACES.find((s) => s.id === surface) ?? SURFACES[0]!;

  return (
    <>
      {/* Drawing surface */}
      {open && (
        <div className="fixed inset-0 z-[60]">
          <div className={`absolute inset-0 ${activeSurface.className} ${surface === "clear" ? "" : "transition-colors"}`} />
          <canvas ref={boardRef} className="absolute inset-0" />
          <canvas
            ref={previewRef}
            className="absolute inset-0 touch-none"
            style={{ cursor: tool === "eraser" ? "cell" : "crosshair" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />

          {/* Tool bar */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4 sm:p-6">
            <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl border border-black/10 bg-white/90 p-2 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#18181b]/90">
              {TOOLS.map((t) => (
                <ToolbarButton
                  key={t.id}
                  label={t.label}
                  active={tool === t.id}
                  onClick={() => setTool(t.id)}
                >
                  <t.icon className="h-4 w-4" />
                </ToolbarButton>
              ))}

              <Divider />

              {/* Colour */}
              <div className="relative">
                <ToolbarButton
                  label="Colour"
                  active={showColors}
                  onClick={() => setShowColors((v) => !v)}
                >
                  <span className="relative flex h-4 w-4 items-center justify-center">
                    <Palette className="h-4 w-4" />
                    <span
                      className="absolute -bottom-1.5 h-1 w-4 rounded-full ring-1 ring-black/20"
                      style={{ backgroundColor: color }}
                    />
                  </span>
                </ToolbarButton>

                {showColors && (
                  <div className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-black/10 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-[#18181b]">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => {
                          setColor(c);
                          setShowColors(false);
                          if (tool === "eraser") setTool("pen");
                        }}
                        aria-label={`Colour ${c}`}
                        className={`h-6 w-6 shrink-0 rounded-full ring-1 ring-black/15 transition-transform hover:scale-110 dark:ring-white/20 ${
                          color === c ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-[#18181b]" : ""
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <label
                      className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full ring-1 ring-black/15 dark:ring-white/20"
                      style={{ background: "conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)" }}
                      title="Custom colour"
                    >
                      <input
                        type="color"
                        value={color}
                        onChange={(e) => setColor(e.target.value)}
                        className="h-0 w-0 opacity-0"
                      />
                    </label>
                  </div>
                )}
              </div>

              {/* Stroke width */}
              <div className="flex items-center gap-0.5">
                {WIDTHS.map((w) => (
                  <ToolbarButton key={w} label={`${w}px`} active={width === w} onClick={() => setWidth(w)}>
                    <span
                      className="rounded-full bg-current"
                      style={{ width: Math.min(w + 2, 16), height: Math.min(w + 2, 16) }}
                    />
                  </ToolbarButton>
                ))}
              </div>

              <Divider />

              <ToolbarButton
                label={`Board: ${activeSurface.label}`}
                onClick={() => {
                  const index = SURFACES.findIndex((s) => s.id === surface);
                  setSurface(SURFACES[(index + 1) % SURFACES.length]!.id);
                }}
              >
                <activeSurface.icon className="h-4 w-4" />
              </ToolbarButton>

              <ToolbarButton label="Undo" onClick={handleUndo} disabled={strokeCount === 0}>
                <Undo2 className="h-4 w-4" />
              </ToolbarButton>

              <ToolbarButton label="Clear board" onClick={handleClear} disabled={strokeCount === 0} danger>
                <Trash2 className="h-4 w-4" />
              </ToolbarButton>

              <Divider />

              <ToolbarButton label="Close whiteboard" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </ToolbarButton>
            </div>
          </div>
        </div>
      )}

      {showAddLink && (
        <AddLinkDialog
          onClose={() => setShowAddLink(false)}
          onAdded={(media) => {
            setShowAddLink(false);
            setPreviewItem(media);
          }}
        />
      )}

      {previewItem && <MediaPreviewModal media={previewItem} onClose={() => setPreviewItem(null)} />}

      {/* Speed-dial FAB — Draw opens the board above, Add Link opens the add-link dialog */}
      {!open && <FabMenu items={fabItems} position="bottom-right" direction="up" label="Whiteboard actions" />}
    </>
  );
}

function Divider() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-black/10 dark:bg-white/10" />;
}

function ToolbarButton({
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
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        active
          ? "bg-blue-600 text-white"
          : danger
            ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}
