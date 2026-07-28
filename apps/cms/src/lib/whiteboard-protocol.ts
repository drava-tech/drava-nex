/**
 * WHITEBOARD_* command names sent over the existing screen command channel
 * (SCREEN_INTERACTION -> gateway relay -> SCREEN_COMMAND, see
 * apps/api/src/ws/gateway.ts and apps/cms/src/hooks/useScreenWebSocket.ts).
 * No gateway/type-package changes needed — `command` is an untyped string and
 * `value` an untyped payload there already; these constants + payload shapes
 * are the contract between whiteboard-overlay.tsx (CMS) and
 * WhiteboardScreenOverlay.tsx (TV) — both directions use the same shapes,
 * since the whiteboard is fully bidirectional (draw on either end, it syncs
 * to both).
 *
 * The gateway relays SCREEN_INTERACTION to *every* client of the screen,
 * **including the sender** — so every payload below carries `senderId` (a
 * random id generated once per mounted board) purely so each side can ignore
 * its own echo instead of double-applying its own strokes.
 */
import type {
  WhiteboardPoint,
  WhiteboardStroke,
  WhiteboardSurface,
  WhiteboardTool,
} from "./whiteboard-canvas";

export const WHITEBOARD_START = "WHITEBOARD_START";
export const WHITEBOARD_STOP = "WHITEBOARD_STOP";
export const WHITEBOARD_SYNC = "WHITEBOARD_SYNC";
export const WHITEBOARD_SURFACE = "WHITEBOARD_SURFACE";
/** Tells the TV which tool/color/width to draw with next — the CMS toolbar controls this when drawing happens by touching the ScreenMirror preview instead of a local canvas. */
export const WHITEBOARD_SET_STYLE = "WHITEBOARD_SET_STYLE";
export const WHITEBOARD_STROKE_BEGIN = "WHITEBOARD_STROKE_BEGIN";
export const WHITEBOARD_STROKE_POINT = "WHITEBOARD_STROKE_POINT";
export const WHITEBOARD_STROKE_END = "WHITEBOARD_STROKE_END";
export const WHITEBOARD_UNDO = "WHITEBOARD_UNDO";
export const WHITEBOARD_CLEAR = "WHITEBOARD_CLEAR";

interface WithSender {
  senderId: string;
}

export interface WhiteboardStartPayload extends WithSender {
  surface: WhiteboardSurface;
}

export interface WhiteboardSyncPayload extends WithSender {
  strokes: WhiteboardStroke[];
  surface: WhiteboardSurface;
}

export interface WhiteboardSurfacePayload extends WithSender {
  surface: WhiteboardSurface;
}

export interface WhiteboardSetStylePayload extends WithSender {
  tool: WhiteboardTool;
  color: string;
  width: number;
}

export interface WhiteboardStrokeBeginPayload extends WithSender {
  tool: WhiteboardTool;
  color: string;
  width: number;
  point: WhiteboardPoint;
}

export interface WhiteboardStrokePointPayload extends WithSender {
  point: WhiteboardPoint;
}

export type WhiteboardStopPayload = WithSender;
export type WhiteboardStrokeEndPayload = WithSender;
export type WhiteboardUndoPayload = WithSender;
export type WhiteboardClearPayload = WithSender;

/** One random id per mounted board — lets each side recognize (and skip) its own echo. */
export function createWhiteboardSenderId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `wb-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}
