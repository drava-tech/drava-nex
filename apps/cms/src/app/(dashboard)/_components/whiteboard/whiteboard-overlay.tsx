"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  Cast,
  Plus,
  ChevronLeft,
  ChevronRight,
  Save,
  Loader2,
} from "lucide-react";
import { FabMenu } from "@/components/fab-menu";
import type { FabMenuItem } from "@/components/fab-menu";
import { LiveControlDialog } from "@/components/live-control-dialog";
import { PushToScreenModal } from "@/components/push-to-screen-modal";
import { createWhiteboard, updateWhiteboard, getWhiteboardDocument } from "@/actions/whiteboard-actions";
import {
  applyStrokeStyle,
  drawWhiteboardStroke,
  normalizedPointFromClient,
  WHITEBOARD_COLORS,
  WHITEBOARD_WIDTHS,
  type WhiteboardPageData,
  type WhiteboardPoint as Point,
  type WhiteboardStroke as Stroke,
  type WhiteboardTool as Tool,
} from "@/lib/whiteboard-canvas";
import {
  createWhiteboardSenderId,
  WHITEBOARD_START,
  WHITEBOARD_STOP,
  WHITEBOARD_SYNC,
  WHITEBOARD_SURFACE,
  WHITEBOARD_SET_STYLE,
  WHITEBOARD_STROKE_BEGIN,
  WHITEBOARD_STROKE_POINT,
  WHITEBOARD_STROKE_END,
  WHITEBOARD_UNDO,
  WHITEBOARD_CLEAR,
} from "@/lib/whiteboard-protocol";
import { applyWhiteboardCommand } from "@/lib/whiteboard-sync";
import { WhiteboardScreenBridge } from "./whiteboard-screen-bridge";

type Surface = "light" | "dark" | "clear";

const TOOLS: { id: Tool; label: string; icon: typeof Pencil }[] = [
  { id: "pen", label: "Pen", icon: Pencil },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "line", label: "Line", icon: Minus },
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "circle", label: "Ellipse", icon: Circle },
];

const SURFACES: { id: Surface; label: string; icon: typeof Sun; className: string }[] = [
  { id: "light", label: "White board", icon: Sun, className: "bg-white" },
  { id: "dark", label: "Dark board", icon: Moon, className: "bg-[#101014]" },
  { id: "clear", label: "Annotate the page", icon: Eye, className: "bg-transparent" },
];

interface WhiteboardOverlayProps {
  /**
   * "overlay" (default): the always-mounted, full-screen popup opened by the
   * "+" FAB from anywhere in the dashboard — covers the sidebar too.
   * "embedded": rendered by /whiteboards/[id]/page.tsx as normal page
   * content instead — no FAB, no popup, the sidebar stays visible because
   * this is just what's inside the page's own content area. Both variants
   * are the same component (not a fork) so drawing/push/save behavior can't
   * drift between them; only sizing and chrome (FAB, close button) differ.
   */
  variant?: "overlay" | "embedded";
  /** embedded only — which saved document to load on mount. */
  initialDocumentId?: string;
}

/**
 * Floating whiteboard + speed dial (variant="overlay"), or an embedded,
 * sidebar-visible editor for one specific saved document
 * (variant="embedded", see /whiteboards/[id]/page.tsx). A "+" FAB in the
 * bottom-right corner opens a menu with "Draw" (pick a screen, then control
 * it exactly like an experience — via the same LiveControlDialog +
 * ScreenMirror everything else uses) and "Browse URL" (navigates to the
 * routed /browser tool — paste a link, pick screens, send); the embedded
 * variant skips the FAB entirely — it's already a page, not a launcher.
 *
 * Strokes are kept as objects and replayed rather than being flattened into
 * pixels — that's what makes undo and resizing work at all. Canvas sizing
 * is measured off canvasContainerRef via ResizeObserver rather than
 * window.innerWidth/innerHeight, so the same drawing math is correct
 * whether that container is the full viewport (overlay) or just the page's
 * content area next to the sidebar (embedded).
 */
export function WhiteboardOverlay({ variant = "overlay", initialDocumentId }: WhiteboardOverlayProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState<string>(WHITEBOARD_COLORS[0] as string);
  const [width, setWidth] = useState<number>(4);
  const [surface, setSurface] = useState<Surface>("light");
  const [showColors, setShowColors] = useState(false);
  const [strokeCount, setStrokeCount] = useState(0);

  // --- Multi-page saved documents ---------------------------------------------
  /** Every page except the active one; the active page's live data lives in strokesRef/surface below. */
  const pagesRef = useRef<WhiteboardPageData[]>([{ surface: "light", strokes: [] }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [documentName, setDocumentName] = useState("Untitled Whiteboard");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // --- Live push to a screen -------------------------------------------------
  const [showPushDialog, setShowPushDialog] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [pushTarget, setPushTarget] = useState<{ screenId: string; screenName: string; isOnline: boolean } | null>(
    null
  );
  const sendRef = useRef<(command: string, value?: unknown) => void>(() => {});
  const senderIdRef = useRef(createWhiteboardSenderId());

  const boardRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  // The canvases' sizing reference — the full viewport for "overlay", just
  // this component's own box for "embedded". A ref, not state: read
  // synchronously from pointer handlers that fire far more often than this
  // component re-renders, always the latest measured size without needing
  // to be in any callback's dependency array.
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const dimensionsRef = useRef({ width: 0, height: 0 });
  const strokesRef = useRef<Stroke[]>([]);
  /** The operator's own in-progress stroke (painted incrementally as they draw). */
  const currentRef = useRef<Stroke | null>(null);
  /** An in-progress stroke someone else (the TV) is currently drawing — only touched by handleRemoteCommand. */
  const remoteCurrentRef = useRef<Stroke | null>(null);

  /** Every outgoing command carries our senderId so we can ignore the gateway's echo of our own messages. */
  const send = useCallback((command: string, payload?: Record<string, unknown>) => {
    sendRef.current(command, { senderId: senderIdRef.current, ...payload });
  }, []);

  const fabItems: FabMenuItem[] = [
    {
      id: "draw",
      label: "Draw",
      icon: <Pencil />,
      onClick: () => {
        // Only reset to a blank board when there's nothing worth keeping —
        // otherwise re-clicking the pencil to check on (or resume) existing
        // work would silently wipe it, saved or not.
        syncActivePageIntoPages();
        const isEmpty = pagesRef.current.every((p) => p.strokes.length === 0);
        if (documentId === null && isEmpty) {
          startFreshWhiteboard();
        }
        setPreviewDataUrl(null);
        setShowPushDialog(true);
      },
    },
    { id: "link", label: "Browse URL", icon: <LinkIcon />, onClick: () => router.push("/browser") },
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
    const { width: w, height: h } = dimensionsRef.current;
    for (const stroke of strokesRef.current) drawWhiteboardStroke(ctx, stroke, w, h);
    if (remoteCurrentRef.current) drawWhiteboardStroke(ctx, remoteCurrentRef.current, w, h);
    // Our own in-progress stroke isn't in strokesRef yet — repaint it too so a
    // remote update arriving mid-stroke (redraw runs) doesn't erase it.
    if (currentRef.current) drawWhiteboardStroke(ctx, currentRef.current, w, h);
  }, []);

  /** Snapshot the currently-active page's live strokes/surface back into pagesRef before switching away or saving. */
  const syncActivePageIntoPages = () => {
    pagesRef.current[pageIndex] = { surface, strokes: strokesRef.current };
  };

  /** Check the given page's data out of pagesRef into the live strokesRef/surface refs, then repaint. */
  const loadPageIntoActive = useCallback(
    (index: number) => {
      const page = pagesRef.current[index] ?? { surface: "light" as const, strokes: [] };
      strokesRef.current = page.strokes;
      currentRef.current = null;
      remoteCurrentRef.current = null;
      setSurface(page.surface);
      setStrokeCount(page.strokes.length);
      redraw();
    },
    [redraw]
  );

  const startFreshWhiteboard = () => {
    pagesRef.current = [{ surface: "light", strokes: [] }];
    setPageIndex(0);
    setDocumentId(null);
    setDocumentName("Untitled Whiteboard");
    loadPageIntoActive(0);
  };

  // Whether the local drawing canvas (as opposed to the live LiveControlDialog
  // panel, or nothing) is the thing on screen right now. "overlay" keeps its
  // FAB-driven open/close toggle; "embedded" has no such toggle — it's just
  // the page, showing the canvas whenever there isn't an active live push.
  const showCanvas = variant === "embedded" ? !pushTarget : open;

  /** Size both layers to canvasContainerRef's current box in device pixels, then replay the strokes. */
  const resizeCanvases = useCallback(() => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    dimensionsRef.current = { width, height };
    const dpr = window.devicePixelRatio || 1;
    for (const canvas of [boardRef.current, previewRef.current]) {
      if (!canvas) continue;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    redraw();
  }, [redraw]);

  useEffect(() => {
    if (!showCanvas) return;
    const container = canvasContainerRef.current;
    if (!container) return;
    resizeCanvases();
    // ResizeObserver, not a window resize listener — "embedded" can change
    // size without the window itself resizing (e.g. the sidebar collapsing),
    // and this covers "overlay" (container === the full viewport) just as well.
    const ro = new ResizeObserver(() => resizeCanvases());
    ro.observe(container);
    return () => ro.disconnect();
  }, [showCanvas, resizeCanvases]);

  // Escape closes the board, but only once it's finished a stroke. Overlay only
  // — "embedded" has nothing modal to dismiss with Escape, it's just the page.
  useEffect(() => {
    if (variant !== "overlay" || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !currentRef.current) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, open]);

  const pointFromEvent = (e: React.PointerEvent<HTMLCanvasElement>): Point =>
    normalizedPointFromClient(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());

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
      const { width: w, height: h } = dimensionsRef.current;
      if (board) drawWhiteboardStroke(board, stroke, w, h);
    }

    if (pushTarget) {
      send(WHITEBOARD_STROKE_BEGIN, {
        tool: stroke.tool,
        color: stroke.color,
        width: stroke.width,
        point: stroke.points[0],
      });
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = currentRef.current;
    if (!stroke) return;
    const point = pointFromEvent(e);
    const { board, preview } = contexts();
    const { width: w, height: h } = dimensionsRef.current;

    if (stroke.tool === "pen" || stroke.tool === "eraser") {
      const previous = stroke.points[stroke.points.length - 1];
      stroke.points.push(point);
      if (board && previous) {
        board.save();
        applyStrokeStyle(board, stroke);
        board.beginPath();
        board.moveTo(previous.x * w, previous.y * h);
        board.lineTo(point.x * w, point.y * h);
        board.stroke();
        board.restore();
      }
      if (pushTarget) send(WHITEBOARD_STROKE_POINT, { point });
      return;
    }

    // Shape: keep exactly two points and re-render the preview each frame.
    stroke.points[1] = point;
    if (preview) {
      // In CSS pixels — the context carries a devicePixelRatio transform.
      preview.clearRect(0, 0, w, h);
      drawWhiteboardStroke(preview, stroke, w, h);
    }
    if (pushTarget) send(WHITEBOARD_STROKE_POINT, { point });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = currentRef.current;
    if (!stroke) return;
    currentRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);

    const { board, preview } = contexts();
    const { width: w, height: h } = dimensionsRef.current;
    if (stroke.tool !== "pen" && stroke.tool !== "eraser") {
      preview?.clearRect(0, 0, w, h);
      if (board) drawWhiteboardStroke(board, stroke, w, h);
    }

    strokesRef.current.push(stroke);
    setStrokeCount(strokesRef.current.length);
    if (pushTarget) send(WHITEBOARD_STROKE_END);
  };

  const handleUndo = () => {
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    redraw();
    if (pushTarget) send(WHITEBOARD_UNDO);
  };

  const handleClear = () => {
    strokesRef.current = [];
    setStrokeCount(0);
    redraw();
    if (pushTarget) send(WHITEBOARD_CLEAR);
  };

  const handleSurfaceToggle = () => {
    const index = SURFACES.findIndex((s) => s.id === surface);
    const next = SURFACES[(index + 1) % SURFACES.length]!.id;
    setSurface(next);
    if (pushTarget) send(WHITEBOARD_SURFACE, { surface: next });
  };

  // --- Multi-page ---------------------------------------------------------

  const switchToPage = (index: number) => {
    if (index === pageIndex || index < 0 || index >= pagesRef.current.length) return;
    syncActivePageIntoPages();
    loadPageIntoActive(index);
    setPageIndex(index);
    // Live push stays scoped to whichever page you're looking at.
    if (pushTarget) {
      const page = pagesRef.current[index]!;
      send(WHITEBOARD_SYNC, { strokes: page.strokes, surface: page.surface });
    }
  };

  const handleNewPage = () => {
    syncActivePageIntoPages();
    pagesRef.current = [...pagesRef.current, { surface: "light", strokes: [] }];
    const newIndex = pagesRef.current.length - 1;
    loadPageIntoActive(newIndex);
    setPageIndex(newIndex);
    if (pushTarget) send(WHITEBOARD_SYNC, { strokes: [], surface: "light" });
  };

  // --- Save / open saved whiteboards --------------------------------------

  const handleSaveClick = () => {
    syncActivePageIntoPages();
    if (documentId) {
      setIsSaving(true);
      updateWhiteboard(documentId, { pages: pagesRef.current })
        .catch((err) => console.error("Failed to save whiteboard:", err))
        .finally(() => setIsSaving(false));
    } else {
      setSaveNameInput(documentName === "Untitled Whiteboard" ? "" : documentName);
      setShowSaveDialog(true);
    }
  };

  const handleConfirmSave = async () => {
    const name = saveNameInput.trim();
    if (!name) return;
    syncActivePageIntoPages();
    setIsSaving(true);
    try {
      const id = await createWhiteboard(name, pagesRef.current);
      setDocumentId(id);
      setDocumentName(name);
      setShowSaveDialog(false);
    } catch (err) {
      console.error("Failed to save whiteboard:", err);
    } finally {
      setIsSaving(false);
    }
  };

  /** Check a saved document out of the DB and into the editor. */
  const loadDocument = useCallback(
    async (id: string) => {
      const doc = await getWhiteboardDocument(id);
      if (!doc) return;
      const pages = doc.pages as unknown as WhiteboardPageData[];
      pagesRef.current = pages.length > 0 ? pages : [{ surface: "light", strokes: [] }];
      setDocumentId(doc.id);
      setDocumentName(doc.name);
      setPageIndex(0);
      loadPageIntoActive(0);
    },
    [loadPageIntoActive]
  );

  // Embedded only — /whiteboards/[id]/page.tsx passes the routed id, loaded
  // once on mount. (Overlay never lands here with a document to load — the
  // whiteboards list now routes straight to /whiteboards/<id> instead.)
  useEffect(() => {
    if (variant !== "embedded" || !initialDocumentId) return;
    loadDocument(initialDocumentId);
  }, [variant, initialDocumentId, loadDocument]);

  // --- Live push to a screen -------------------------------------------------

  const handleBridgeStatusChange = useCallback(
    (status: "connecting" | "connected" | "disconnected") => {
      if (status !== "connected") return;
      send(WHITEBOARD_START, { surface });
      send(WHITEBOARD_SYNC, { strokes: strokesRef.current, surface });
      send(WHITEBOARD_SET_STYLE, { tool, color, width: tool === "eraser" ? width * 4 : width });
    },
    [send, surface, tool, color, width]
  );

  // Keep the TV's touch style current with the CMS toolbar while a session is live.
  useEffect(() => {
    if (!pushTarget) return;
    send(WHITEBOARD_SET_STYLE, { tool, color, width: tool === "eraser" ? width * 4 : width });
  }, [pushTarget, tool, color, width, send]);

  // Applies a stroke the TV (or the ScreenMirror preview) drew to our own
  // board — the mirror image of the pointer handlers above, which apply our
  // strokes to the TV.
  const handleRemoteCommand = useCallback(
    (command: string, value: any) => {
      if (value?.senderId === senderIdRef.current) return; // our own echo
      const next = applyWhiteboardCommand(
        { strokes: strokesRef.current, current: remoteCurrentRef.current, surface },
        command,
        value
      );
      strokesRef.current = next.strokes;
      remoteCurrentRef.current = next.current;
      if (next.surface !== surface) setSurface(next.surface);
      setStrokeCount(strokesRef.current.length);
      redraw();
    },
    [surface, redraw]
  );

  const handleSelectPushTarget = (screenId: string, screenName: string, isOnline: boolean) => {
    setShowPushDialog(false);
    setOpen(false);
    setPushTarget({ screenId, screenName, isOnline });

    // Give the live session a real, bookmarkable/refresh-safe /whiteboards/<id>
    // URL. Auto-saves as "Untitled Whiteboard" first if this board was never
    // explicitly saved — same as clicking Save would, just without the name
    // prompt — so pushing always ends up with a real id. Fired after the live
    // session already started above; a slow save shouldn't delay going live.
    if (documentId === null) {
      syncActivePageIntoPages();
      createWhiteboard(documentName, pagesRef.current)
        .then((id) => {
          setDocumentId(id);
          router.push(`/whiteboards/${id}`);
        })
        .catch((err) => console.error("Failed to auto-save whiteboard before going live:", err));
    } else {
      router.push(`/whiteboards/${documentId}`);
    }
  };

  const handleSkipPush = () => {
    setShowPushDialog(false);
    setOpen(true);
  };

  const stopPush = () => {
    send(WHITEBOARD_STOP);
    setPushTarget(null);
  };

  const activeSurface = SURFACES.find((s) => s.id === surface) ?? SURFACES[0]!;

  return (
    <>
      {/* Drawing surface — local-only sketch (no screen picked, or "Draw without pushing").
          "overlay" covers the whole viewport including the sidebar; "embedded"
          is just this page's own content box, sidebar left visible. */}
      {showCanvas && (
        <div
          ref={canvasContainerRef}
          className={variant === "overlay" ? "fixed inset-0 z-[60]" : "relative h-[calc(100vh-5rem)] w-full overflow-hidden"}
        >
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

          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4 sm:p-6">
            <WhiteboardToolStrip
              tool={tool}
              setTool={setTool}
              color={color}
              setColor={setColor}
              width={width}
              setWidth={setWidth}
              showColors={showColors}
              setShowColors={setShowColors}
              activeSurface={activeSurface}
              onSurfaceToggle={handleSurfaceToggle}
              strokeCount={strokeCount}
              onUndo={handleUndo}
              onClear={handleClear}
              trailing={
                <>
                  <ToolbarButton
                    label="Previous page"
                    onClick={() => switchToPage(pageIndex - 1)}
                    disabled={pageIndex === 0}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </ToolbarButton>
                  <span className="px-0.5 text-[10px] font-bold text-zinc-500 dark:text-zinc-400 tabular-nums">
                    {pageIndex + 1}/{pagesRef.current.length}
                  </span>
                  <ToolbarButton
                    label="Next page"
                    onClick={() => switchToPage(pageIndex + 1)}
                    disabled={pageIndex === pagesRef.current.length - 1}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </ToolbarButton>
                  <ToolbarButton label="New page" onClick={handleNewPage}>
                    <Plus className="h-4 w-4" />
                  </ToolbarButton>

                  <Divider />

                  <ToolbarButton
                    label={documentId ? `Save "${documentName}"` : "Save whiteboard"}
                    onClick={handleSaveClick}
                    disabled={isSaving}
                  >
                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  </ToolbarButton>

                  <Divider />

                  <ToolbarButton
                    label={pushTarget ? `Live on ${pushTarget.screenName}` : "Push to screen"}
                    active={!!pushTarget}
                    onClick={() => {
                      setPreviewDataUrl(boardRef.current?.toDataURL("image/png") ?? null);
                      setShowPushDialog(true);
                    }}
                  >
                    <Cast className="h-4 w-4" />
                  </ToolbarButton>
                  {variant === "overlay" && (
                    <>
                      <Divider />
                      <ToolbarButton label="Close whiteboard" onClick={() => setOpen(false)}>
                        <X className="h-4 w-4" />
                      </ToolbarButton>
                    </>
                  )}
                </>
              }
            />
          </div>
        </div>
      )}

      {/* Live push — same control panel every other experience uses. Drawing
          controls live on the mirror itself (it's the same page as the real
          TV, so it already shows its own tool/color/undo/clear/exit bar) — but
          page switching + save are CMS-side concerns (the TV only ever shows
          the one active page), so those still live here. */}
      {pushTarget && (
        <LiveControlDialog
          experienceName="Whiteboard"
          screens={[{ screenId: pushTarget.screenId, screenName: pushTarget.screenName, isOnline: pushTarget.isOnline }]}
          onClose={stopPush}
          toolbar={
            <div className="flex flex-col items-stretch gap-1.5 rounded-2xl border border-black/10 bg-white/90 p-2 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#18181b]/90">
              <div className="flex items-center gap-1">
                <ToolbarButton
                  label="Previous page"
                  onClick={() => switchToPage(pageIndex - 1)}
                  disabled={pageIndex === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </ToolbarButton>
                <span className="flex-1 text-center text-[10px] font-bold text-zinc-500 dark:text-zinc-400 tabular-nums">
                  Page {pageIndex + 1}/{pagesRef.current.length}
                </span>
                <ToolbarButton
                  label="Next page"
                  onClick={() => switchToPage(pageIndex + 1)}
                  disabled={pageIndex === pagesRef.current.length - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </ToolbarButton>
              </div>

              <WideToolbarButton label="New page" onClick={handleNewPage}>
                <Plus className="h-4 w-4" />
              </WideToolbarButton>

              <HDivider />

              <WideToolbarButton
                label={documentId ? `Save "${documentName}"` : "Save whiteboard"}
                onClick={handleSaveClick}
                disabled={isSaving}
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              </WideToolbarButton>

              <HDivider />

              <WideToolbarButton label="Stop whiteboard" onClick={stopPush} danger>
                <X className="h-4 w-4" />
              </WideToolbarButton>
            </div>
          }
        />
      )}

      {showPushDialog && (
        <PushToScreenModal
          contentName={previewDataUrl ? "Live Whiteboard" : "New Whiteboard"}
          subtitle={
            previewDataUrl
              ? "Keeps updating live as you keep drawing"
              : "Pick a screen to replicate your drawing to, live"
          }
          preview={
            previewDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewDataUrl} alt="Whiteboard preview" className="max-h-full max-w-full object-contain" />
            ) : undefined
          }
          onClose={() => setShowPushDialog(false)}
          // No content to persist upfront — WhiteboardScreenBridge starts the
          // live session itself (WHITEBOARD_START) once pushTarget is set and
          // its WS connection comes up. See handleBridgeStatusChange.
          onPush={async () => {}}
          onPushed={(pushed) => {
            const target = pushed[0];
            if (target) handleSelectPushTarget(target.screenId, target.screenName, target.isOnline);
          }}
          onSkip={handleSkipPush}
          skipLabel="Draw without pushing"
        />
      )}

      {showSaveDialog && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          onClick={() => setShowSaveDialog(false)}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-sm bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 tracking-[0.25em] uppercase mb-1">
              Save Whiteboard
            </p>
            <input
              autoFocus
              value={saveNameInput}
              onChange={(e) => setSaveNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirmSave();
              }}
              placeholder="Whiteboard name"
              className="mt-2 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSaveDialog(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSave}
                disabled={!saveNameInput.trim() || isSaving}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 text-xs font-bold uppercase tracking-wider disabled:opacity-50"
              >
                {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {pushTarget && (
        <WhiteboardScreenBridge
          screenId={pushTarget.screenId}
          sendRef={sendRef}
          onStatusChange={handleBridgeStatusChange}
          onCommand={handleRemoteCommand}
        />
      )}

      {/* Speed-dial FAB — Draw opens the board above, Browse URL navigates to /browser.
          Overlay only — "embedded" is already the whiteboard, no launcher needed. */}
      {variant === "overlay" && !open && (
        <FabMenu items={fabItems} position="bottom-right" direction="up" label="Whiteboard actions" />
      )}
    </>
  );
}

/** Tools / colour / width / surface / undo / clear — shared between the full-screen local board and the LiveControlDialog panel. */
function WhiteboardToolStrip({
  tool,
  setTool,
  color,
  setColor,
  width,
  setWidth,
  showColors,
  setShowColors,
  activeSurface,
  onSurfaceToggle,
  strokeCount,
  onUndo,
  onClear,
  trailing,
}: {
  tool: Tool;
  setTool: (t: Tool) => void;
  color: string;
  setColor: (c: string) => void;
  width: number;
  setWidth: (w: number) => void;
  showColors: boolean;
  setShowColors: (v: boolean | ((prev: boolean) => boolean)) => void;
  activeSurface: { id: Surface; label: string; icon: typeof Sun; className: string };
  onSurfaceToggle: () => void;
  strokeCount: number;
  onUndo: () => void;
  onClear: () => void;
  trailing: React.ReactNode;
}) {
  return (
    <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl border border-black/10 bg-white/90 p-2 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#18181b]/90">
      {TOOLS.map((t) => (
        <ToolbarButton key={t.id} label={t.label} active={tool === t.id} onClick={() => setTool(t.id)}>
          <t.icon className="h-4 w-4" />
        </ToolbarButton>
      ))}

      <Divider />

      {/* Colour */}
      <div className="relative">
        <ToolbarButton label="Colour" active={showColors} onClick={() => setShowColors((v) => !v)}>
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
            {WHITEBOARD_COLORS.map((c) => (
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
        {WHITEBOARD_WIDTHS.map((w) => (
          <ToolbarButton key={w} label={`${w}px`} active={width === w} onClick={() => setWidth(w)}>
            <span
              className="rounded-full bg-current"
              style={{ width: Math.min(w + 2, 16), height: Math.min(w + 2, 16) }}
            />
          </ToolbarButton>
        ))}
      </div>

      <Divider />

      <ToolbarButton label={`Board: ${activeSurface.label}`} onClick={onSurfaceToggle}>
        <activeSurface.icon className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton label="Undo" onClick={onUndo} disabled={strokeCount === 0}>
        <Undo2 className="h-4 w-4" />
      </ToolbarButton>

      <ToolbarButton label="Clear board" onClick={onClear} disabled={strokeCount === 0} danger>
        <Trash2 className="h-4 w-4" />
      </ToolbarButton>

      <Divider />

      {trailing}
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-black/10 dark:bg-white/10" />;
}

/** Horizontal rule for vertical (side-rail) toolbars — Divider above is for horizontal rows. */
function HDivider() {
  return <span className="my-0.5 h-px w-full shrink-0 bg-black/10 dark:bg-white/10" />;
}

/** Full-width labeled button for a vertical side rail — there's room for a label there, unlike the square icon buttons in a horizontal row. */
function WideToolbarButton({
  children,
  label,
  danger,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        danger
          ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10"
      }`}
    >
      {children}
      <span className="truncate">{label}</span>
    </button>
  );
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
