"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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
  AlertTriangle,
} from "lucide-react";
import { FabMenu } from "@/components/fab-menu";
import type { FabMenuItem } from "@/components/fab-menu";
import { PushToScreenModal } from "@/components/push-to-screen-modal";
import { setScreenWhiteboardSession } from "@/actions/screen-actions";
import { createWhiteboard, updateWhiteboard, getWhiteboardDocument, listWhiteboards } from "@/actions/whiteboard-actions";
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
  /**
   * embedded only — set by /whiteboards/[id]/live/[deviceId] to auto-resume a
   * live push to this screen once initialDocumentId has loaded, instead of
   * showing the screen picker again.
   */
  initialPushTarget?: { screenId: string; screenName: string; isOnline: boolean };
}

/**
 * Floating whiteboard + speed dial (variant="overlay"), or an embedded,
 * sidebar-visible editor for one specific saved document
 * (variant="embedded", see /whiteboards/[id]/page.tsx and
 * /whiteboards/[id]/live/[deviceId]/page.tsx). A "+" FAB in the bottom-right
 * corner opens a menu with "Draw" (pick a screen, saves the board, then
 * navigates to the live route — same canvas + toolbar throughout, just with
 * the cast button now reading "Live on <screen>" and strokes relaying to it)
 * and "Browse URL" (navigates to the routed /browser tool — paste a link,
 * pick screens, send); the embedded variant skips the FAB entirely — it's
 * already a page, not a launcher.
 *
 * Strokes are kept as objects and replayed rather than being flattened into
 * pixels — that's what makes undo and resizing work at all. Canvas sizing
 * is measured off canvasContainerRef via ResizeObserver rather than
 * window.innerWidth/innerHeight, so the same drawing math is correct
 * whether that container is the full viewport (overlay) or just the page's
 * content area next to the sidebar (embedded).
 */
export function WhiteboardOverlay({ variant = "overlay", initialDocumentId, initialPushTarget }: WhiteboardOverlayProps) {
  const router = useRouter();
  const pathname = usePathname();
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
  /** A saved whiteboard whose name collides with saveNameInput — confirm replacing it before overwriting. */
  const [duplicateMatch, setDuplicateMatch] = useState<{ id: string; name: string } | null>(null);

  // --- Unsaved-changes guard ---------------------------------------------
  // Ref, not state: read synchronously from a document-level click listener
  // that isn't part of this component's own render cycle.
  const dirtyRef = useRef(false);
  /** href of an in-app navigation (Link click) blocked pending a save/discard/cancel decision. */
  const [pendingNavHref, setPendingNavHref] = useState<string | null>(null);

  // --- Live push to a screen -------------------------------------------------
  const [showPushDialog, setShowPushDialog] = useState(false);
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
  /**
   * The board's own letterboxed size within canvasContainerRef — state (not
   * just dimensionsRef) because it sizes the board box in JSX. Every screen
   * this can be pushed to renders 16:9 (see ScreenMirror/LiveControlDialog),
   * so without locking the drawing surface to that same ratio, a point
   * normalized against this editor's own (arbitrary) window shape lands in a
   * different relative spot once replayed on the actual 16:9 TV — that's why
   * the TV never quite matched what was drawn here.
   */
  const [boardBox, setBoardBox] = useState({ width: 0, height: 0 });
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
    dirtyRef.current = false;
  };

  // Whether the local drawing canvas + toolbar is the thing on screen right
  // now. "overlay" keeps its FAB-driven open/close toggle. "embedded" has no
  // such toggle — it's just the page, and stays on the same canvas/toolbar
  // UI whether or not a live push is active (the toolbar's cast button just
  // switches between "Push to screen" and "Live on <screen>").
  const showCanvas = variant === "embedded" ? true : open;

  /** Size both layers to a 16:9 box letterboxed within canvasContainerRef's current space, in device pixels, then replay the strokes. */
  const resizeCanvases = useCallback(() => {
    const container = canvasContainerRef.current;
    if (!container) return;
    const availWidth = container.clientWidth;
    const availHeight = container.clientHeight;
    const width = Math.min(availWidth, availHeight * (16 / 9));
    const height = width * (9 / 16);
    dimensionsRef.current = { width, height };
    setBoardBox({ width, height });
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
        applyStrokeStyle(board, stroke, w);
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
    dirtyRef.current = true;
    if (pushTarget) send(WHITEBOARD_STROKE_END);
  };

  const handleUndo = () => {
    strokesRef.current.pop();
    setStrokeCount(strokesRef.current.length);
    redraw();
    dirtyRef.current = true;
    if (pushTarget) send(WHITEBOARD_UNDO);
  };

  const handleClear = () => {
    strokesRef.current = [];
    setStrokeCount(0);
    redraw();
    dirtyRef.current = true;
    if (pushTarget) send(WHITEBOARD_CLEAR);
  };

  const handleSurfaceToggle = () => {
    const index = SURFACES.findIndex((s) => s.id === surface);
    const next = SURFACES[(index + 1) % SURFACES.length]!.id;
    setSurface(next);
    dirtyRef.current = true;
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
    dirtyRef.current = true;
    if (pushTarget) send(WHITEBOARD_SYNC, { strokes: [], surface: "light" });
  };

  // --- Save / open saved whiteboards --------------------------------------

  // Always asks for a label, whether this is the first save or a re-save —
  // pre-filled with the current name so re-saving under the same name is
  // just hitting Enter.
  const handleSaveClick = () => {
    syncActivePageIntoPages();
    setSaveNameInput(documentName === "Untitled Whiteboard" ? "" : documentName);
    setDuplicateMatch(null);
    setShowSaveDialog(true);
  };

  /** Actually writes the board, closes every save-flow dialog, clears the dirty flag, and resumes any navigation that was waiting on this save. */
  const persistSave = async (targetId: string | null, name: string) => {
    if (targetId) {
      await updateWhiteboard(targetId, { name, pages: pagesRef.current });
      setDocumentId(targetId);
    } else {
      const id = await createWhiteboard(name, pagesRef.current);
      setDocumentId(id);
    }
    setDocumentName(name);
    setShowSaveDialog(false);
    setDuplicateMatch(null);
    dirtyRef.current = false;
    if (pendingNavHref) {
      const href = pendingNavHref;
      setPendingNavHref(null);
      router.push(href);
    }
  };

  const handleConfirmSave = async () => {
    const name = saveNameInput.trim();
    if (!name) return;
    syncActivePageIntoPages();
    setIsSaving(true);
    try {
      // A different saved board already has this name — ask before silently
      // creating a same-named duplicate (or renaming this one over it).
      const existing = await listWhiteboards();
      const collision = existing.find(
        (b) => b.id !== documentId && b.name.trim().toLowerCase() === name.toLowerCase()
      );
      if (collision) {
        setDuplicateMatch({ id: collision.id, name: collision.name });
        return;
      }
      await persistSave(documentId, name);
    } catch (err) {
      console.error("Failed to save whiteboard:", err);
    } finally {
      setIsSaving(false);
    }
  };

  /** User chose "Replace" on the name-collision prompt — overwrite that other board instead of the one (if any) we were already editing. */
  const handleConfirmReplace = async () => {
    if (!duplicateMatch) return;
    setIsSaving(true);
    try {
      await persistSave(duplicateMatch.id, saveNameInput.trim());
    } catch (err) {
      console.error("Failed to save whiteboard:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // Browser-level navigation (tab close, refresh, typing a new URL) — the
  // browser's own native prompt; its text/buttons can't be customized.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // In-app navigation (any Link click — sidebar, breadcrumb, anywhere else
  // in the dashboard). Next's App Router has no router-level navigation
  // guard, so this intercepts at the DOM level instead: every Link renders
  // as a real <a>, so a capture-phase click listener catches them all
  // before Next's own handler does. Left-clicks only — modified clicks
  // (new tab, etc.) and clicks outside any link pass through untouched.
  useEffect(() => {
    const onDocumentClick = (e: MouseEvent) => {
      if (!dirtyRef.current) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self")) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingNavHref(href);
    };
    document.addEventListener("click", onDocumentClick, true);
    return () => document.removeEventListener("click", onDocumentClick, true);
  }, []);

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
      dirtyRef.current = false;
    },
    [loadPageIntoActive]
  );

  // Embedded only — /whiteboards/[id]/page.tsx passes the routed id, loaded
  // once on mount. (Overlay never lands here with a document to load — the
  // whiteboards list now routes straight to /whiteboards/<id> instead.)
  // /whiteboards/[id]/live/[deviceId] additionally passes initialPushTarget —
  // once the saved strokes are loaded, resume pushing to that screen instead
  // of showing the picker again.
  useEffect(() => {
    if (variant !== "embedded" || !initialDocumentId) return;
    loadDocument(initialDocumentId).then(() => {
      if (initialPushTarget) setPushTarget(initialPushTarget);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, initialDocumentId, loadDocument]);

  // --- Live push to a screen -------------------------------------------------

  const handleBridgeStatusChange = useCallback(
    (status: "connecting" | "connected" | "disconnected") => {
      if (status !== "connected") return;
      send(WHITEBOARD_START, { surface });
      send(WHITEBOARD_SYNC, { strokes: strokesRef.current, surface });
      send(WHITEBOARD_SET_STYLE, { tool, color, width: tool === "eraser" ? width * 4 : width });
      // Lets another CMS tab's "Control" button (the /screens list) jump
      // straight back into this same live session — see stopPush for the
      // matching clear.
      if (pushTarget && documentId) {
        setScreenWhiteboardSession(pushTarget.screenId, documentId).catch((err) =>
          console.error("Failed to record live whiteboard session:", err)
        );
      }
    },
    [send, surface, tool, color, width, pushTarget, documentId]
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
      dirtyRef.current = true;
      redraw();
    },
    [surface, redraw]
  );

  const handleSelectPushTarget = (screenId: string) => {
    setShowPushDialog(false);
    setOpen(false);
    syncActivePageIntoPages();

    // Give the live session a real, bookmarkable/refresh-safe
    // /whiteboards/<id>/live/<deviceId> URL — same /live/<deviceId>
    // convention experiences/media/browser use. Auto-saves current strokes
    // first (as "Untitled Whiteboard" if this board was never explicitly
    // saved) so the routed page always has fresh strokes to load; the
    // WhiteboardOverlay mounted there resumes the live push itself (see
    // initialPushTarget) once that load completes.
    const goLive = (id: string) => router.push(`/whiteboards/${id}/live/${screenId}`);
    if (documentId === null) {
      createWhiteboard(documentName, pagesRef.current)
        .then((id) => {
          setDocumentId(id);
          goLive(id);
        })
        .catch((err) => console.error("Failed to auto-save whiteboard before going live:", err));
    } else {
      updateWhiteboard(documentId, { pages: pagesRef.current })
        .catch((err) => console.error("Failed to save whiteboard before going live:", err))
        .finally(() => goLive(documentId));
    }
  };

  const handleSkipPush = () => {
    setShowPushDialog(false);
    setOpen(true);
  };

  const stopPush = () => {
    send(WHITEBOARD_STOP);
    if (pushTarget) {
      setScreenWhiteboardSession(pushTarget.screenId, null).catch((err) =>
        console.error("Failed to clear live whiteboard session:", err)
      );
    }
    setPushTarget(null);
    // Leave the /live/<deviceId> URL once the session ends, back to the
    // plain document route.
    if (documentId && pathname.includes("/live/")) {
      router.push(`/whiteboards/${documentId}`);
    }
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
          className={
            variant === "overlay"
              ? "fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950"
              : "relative flex h-[calc(100vh-5rem)] w-full items-center justify-center overflow-hidden bg-zinc-950"
          }
        >
          {/* Letterboxed to 16:9 — every screen this pushes to renders at
              that ratio, so the board has to match it too or normalized
              points land in the wrong relative spot on the real screen. */}
          <div className="relative" style={{ width: boardBox.width, height: boardBox.height }}>
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
          </div>

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
                    label={pushTarget ? `Live on ${pushTarget.screenName} — click to stop` : "Push to screen"}
                    active={!!pushTarget}
                    onClick={() => {
                      if (pushTarget) {
                        stopPush();
                        return;
                      }
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

      {showPushDialog && (
        // No `preview` prop — same compact, no-image screen-picker used
        // everywhere else content gets pushed (e.g. experiences); a
        // whiteboard has no fixed shot worth showing since it keeps
        // updating live as you draw.
        <PushToScreenModal
          contentName={documentName}
          subtitle="Pick a screen to replicate your drawing to, live"
          onClose={() => setShowPushDialog(false)}
          // No content to persist upfront — WhiteboardScreenBridge starts the
          // live session itself (WHITEBOARD_START) once pushTarget is set and
          // its WS connection comes up. See handleBridgeStatusChange.
          onPush={async () => {}}
          onPushed={(pushed) => {
            const target = pushed[0];
            if (target) handleSelectPushTarget(target.screenId);
          }}
          onSkip={handleSkipPush}
          skipLabel="Draw without pushing"
        />
      )}

      {showSaveDialog && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          onClick={() => {
            setShowSaveDialog(false);
            setDuplicateMatch(null);
            setPendingNavHref(null);
          }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-sm bg-white dark:bg-zinc-950 border border-[#432992] rounded-2xl p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {duplicateMatch ? (
              <>
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                      Replace &quot;{duplicateMatch.name}&quot;?
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      A whiteboard already has this name. Saving will overwrite its content — this can&apos;t be
                      undone.
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setDuplicateMatch(null)}
                    className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmReplace}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold uppercase tracking-wider hover:bg-red-700 disabled:opacity-50"
                  >
                    {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Replace
                  </button>
                </div>
              </>
            ) : (
              <>
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
                  className="mt-2 w-full rounded-xl border border-[#432992] bg-zinc-50 dark:bg-zinc-900 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 outline-none focus:border-zinc-400 dark:focus:border-zinc-600"
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSaveDialog(false);
                      setPendingNavHref(null);
                    }}
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
              </>
            )}
          </div>
        </div>
      )}

      {/* Blocks in-app navigation (see the document-click guard above) and
          the FAB/toolbar close actions below while there's unsaved content. */}
      {pendingNavHref && !showSaveDialog && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setPendingNavHref(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-[#432992] bg-white p-5 shadow-2xl dark:bg-zinc-950"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Unsaved changes</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  This board has drawing that hasn&apos;t been saved yet. Save it before leaving, or discard it?
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  syncActivePageIntoPages();
                  setSaveNameInput(documentName === "Untitled Whiteboard" ? "" : documentName);
                  setDuplicateMatch(null);
                  setShowSaveDialog(true);
                }}
                className="flex h-10 items-center justify-center gap-2 rounded-xl bg-zinc-900 text-xs font-bold uppercase tracking-wider text-zinc-100 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  const href = pendingNavHref;
                  dirtyRef.current = false;
                  setPendingNavHref(null);
                  router.push(href);
                }}
                className="flex h-10 items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 text-xs font-bold uppercase tracking-wider text-red-600 hover:bg-red-500/20 dark:text-red-400"
              >
                Discard &amp; leave
              </button>
              <button
                type="button"
                onClick={() => setPendingNavHref(null)}
                className="flex h-9 items-center justify-center text-xs font-bold uppercase tracking-wider text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Cancel
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

/** Tools / colour / width / surface / undo / clear / page nav / save / cast — the one toolbar, local or live. */
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
