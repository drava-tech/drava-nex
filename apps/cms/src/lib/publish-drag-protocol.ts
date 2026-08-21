/**
 * PUBLISH_DRAG_* command names sent over the existing screen command channel
 * (SCREEN_INTERACTION -> gateway relay -> SCREEN_COMMAND, see
 * apps/api/src/ws/gateway.ts and apps/cms/src/hooks/useScreenWebSocket.ts).
 * No gateway/type-package changes needed — `command` is an untyped string and
 * `value` an untyped payload there already; these constants + payload shapes
 * are the contract between publish-board.tsx's SwipeCard (CMS, sender only)
 * and PublishDragOverlay.tsx (TV, receiver only) — unlike the whiteboard
 * protocol this is strictly one-directional, so there's no senderId/echo
 * guard here.
 */

export const PUBLISH_DRAG_START = "PUBLISH_DRAG_START";
export const PUBLISH_DRAG_PROGRESS = "PUBLISH_DRAG_PROGRESS";
export const PUBLISH_DRAG_END = "PUBLISH_DRAG_END";

export interface PublishDragStartPayload {
  cardId: string;
  title: string;
  thumbnail: string | null;
  type: "experience" | "image" | "video";
}

export interface PublishDragProgressPayload {
  cardId: string;
  /** 0 (not dragged) .. 1 (fully arrived — reached the commit threshold). */
  progress: number;
}

export interface PublishDragEndPayload {
  cardId: string;
  /** True if the swipe crossed the threshold and the real publish fired. */
  committed: boolean;
}
