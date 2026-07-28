/**
 * Pure reducer applying an incoming WHITEBOARD_* command to local board
 * state. Used identically by the CMS operator's board (receiving strokes the
 * TV drew) and the TV's overlay (receiving strokes the CMS drew) — the only
 * thing that differs between the two is who's sending vs. receiving at any
 * given moment, which the shared shape doesn't need to know about.
 */
import type { WhiteboardStroke, WhiteboardSurface } from "./whiteboard-canvas";
import {
  WHITEBOARD_CLEAR,
  WHITEBOARD_STROKE_BEGIN,
  WHITEBOARD_STROKE_END,
  WHITEBOARD_STROKE_POINT,
  WHITEBOARD_SURFACE,
  WHITEBOARD_SYNC,
  WHITEBOARD_UNDO,
} from "./whiteboard-protocol";

export interface WhiteboardSyncState {
  strokes: WhiteboardStroke[];
  current: WhiteboardStroke | null;
  surface: WhiteboardSurface;
}

export function initialWhiteboardSyncState(surface: WhiteboardSurface = "light"): WhiteboardSyncState {
  return { strokes: [], current: null, surface };
}

/** `value` is whatever payload shape came off the wire for `command` — see whiteboard-protocol.ts. */
export function applyWhiteboardCommand(
  state: WhiteboardSyncState,
  command: string,
  value: any
): WhiteboardSyncState {
  switch (command) {
    case WHITEBOARD_SYNC:
      return { strokes: value?.strokes ?? [], current: null, surface: value?.surface ?? state.surface };
    case WHITEBOARD_SURFACE:
      return { ...state, surface: value?.surface ?? state.surface };
    case WHITEBOARD_STROKE_BEGIN:
      if (!value?.point) return state;
      return {
        ...state,
        current: { tool: value.tool, color: value.color, width: value.width, points: [value.point] },
      };
    case WHITEBOARD_STROKE_POINT: {
      if (!state.current || !value?.point) return state;
      const tool = state.current.tool;
      const points =
        tool === "pen" || tool === "eraser"
          ? [...state.current.points, value.point]
          : [state.current.points[0]!, value.point];
      return { ...state, current: { ...state.current, points } };
    }
    case WHITEBOARD_STROKE_END:
      if (!state.current) return state;
      return { ...state, strokes: [...state.strokes, state.current], current: null };
    case WHITEBOARD_UNDO:
      return { ...state, strokes: state.strokes.slice(0, -1), current: null };
    case WHITEBOARD_CLEAR:
      return { ...state, strokes: [], current: null };
    default:
      return state;
  }
}
