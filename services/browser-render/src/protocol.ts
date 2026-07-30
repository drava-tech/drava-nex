/**
 * Minimal slice of the platform's WS gateway protocol this service speaks.
 * Source of truth is packages/types/src/index.ts (WsClientMessage/WsServerMessage,
 * the BROWSER_* and STREAM_* members) — duplicated here rather than imported
 * because this service deliberately sits outside the pnpm workspace, same as
 * services/vision and services/product-vision. Keep in sync by hand.
 */

export type ControlMessage =
  | { type: "BROWSER_RENDER_REGISTER_ACK" }
  | { type: "BROWSER_RENDER_REGISTER_NACK"; reason: string }
  | {
      type: "BROWSER_SESSION_START";
      sessionId: string;
      url: string;
      interactive: boolean;
      viewport?: { width: number; height: number };
    }
  | { type: "BROWSER_SESSION_STOP"; sessionId: string }
  | {
      type: "BROWSER_CONTROL";
      sessionId: string;
      action: "navigate" | "back" | "forward" | "reload" | "click" | "scroll" | "key" | "type";
      x?: number;
      y?: number;
      deltaY?: number;
      key?: string;
      text?: string;
      url?: string;
    };

export interface DefaultViewport {
  width: number;
  height: number;
}

export const DEFAULT_VIEWPORT: DefaultViewport = { width: 1280, height: 720 };

/** frameType byte prefixing every binary frame on a STREAM_PUBLISH connection. */
export const MJPEG_FRAME_TYPE = 1;
