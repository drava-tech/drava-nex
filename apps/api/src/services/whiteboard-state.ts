/**
 * Server-side reconstruction of live whiteboard state, so the gateway can
 * persist it and replay it to a client that (re)connects mid-session (e.g. a
 * TV display page refresh). Deliberately duplicated from
 * apps/cms/src/lib/whiteboard-protocol.ts + whiteboard-sync.ts rather than
 * shared cross-app — keep the WHITEBOARD_* command names and the reducer's
 * behavior in sync with that source of truth if either changes.
 */

export const WHITEBOARD_START = "WHITEBOARD_START";
export const WHITEBOARD_STOP = "WHITEBOARD_STOP";
export const WHITEBOARD_SYNC = "WHITEBOARD_SYNC";
export const WHITEBOARD_SURFACE = "WHITEBOARD_SURFACE";
export const WHITEBOARD_SET_STYLE = "WHITEBOARD_SET_STYLE";
export const WHITEBOARD_STROKE_BEGIN = "WHITEBOARD_STROKE_BEGIN";
export const WHITEBOARD_STROKE_POINT = "WHITEBOARD_STROKE_POINT";
export const WHITEBOARD_STROKE_END = "WHITEBOARD_STROKE_END";
export const WHITEBOARD_UNDO = "WHITEBOARD_UNDO";
export const WHITEBOARD_CLEAR = "WHITEBOARD_CLEAR";

const WHITEBOARD_COMMANDS = new Set([
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
]);

/** High-frequency drag events are skipped for DB writes — only these mark a stable point worth persisting. */
const SETTLING_COMMANDS = new Set([
  WHITEBOARD_START,
  WHITEBOARD_STOP,
  WHITEBOARD_SYNC,
  WHITEBOARD_SURFACE,
  WHITEBOARD_UNDO,
  WHITEBOARD_CLEAR,
  WHITEBOARD_STROKE_END,
]);

export function isWhiteboardCommand(command: string): boolean {
  return WHITEBOARD_COMMANDS.has(command);
}

export function isSettlingWhiteboardCommand(command: string): boolean {
  return SETTLING_COMMANDS.has(command);
}

export type WhiteboardSurface = "light" | "dark" | "clear";

export interface WhiteboardStroke {
  tool: string;
  color: string;
  width: number;
  points: { x: number; y: number }[];
}

export interface WhiteboardSyncState {
  strokes: WhiteboardStroke[];
  current: WhiteboardStroke | null;
  surface: WhiteboardSurface;
}

export function initialWhiteboardSyncState(surface: WhiteboardSurface = "light"): WhiteboardSyncState {
  return { strokes: [], current: null, surface };
}

/** Mirrors apps/cms/src/lib/whiteboard-sync.ts's applyWhiteboardCommand exactly (minus WHITEBOARD_START/STOP, handled by the gateway directly since they reset/clear state rather than transform it). */
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
