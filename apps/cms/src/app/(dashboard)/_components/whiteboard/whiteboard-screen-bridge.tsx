"use client";

import { useEffect, type MutableRefObject } from "react";
import { useScreenWebSocket } from "@/hooks/useScreenWebSocket";

const noop = () => {};

interface WhiteboardScreenBridgeProps {
  screenId: string;
  /** Populated with the live `sendInteraction` fn once connected; cleared on unmount. */
  sendRef: MutableRefObject<(command: string, value?: unknown) => void>;
  onStatusChange?: (status: "connecting" | "connected" | "disconnected") => void;
  /** Fired for every SCREEN_COMMAND this screen relays — including strokes the TV itself drew. */
  onCommand?: (command: string, value?: unknown) => void;
}

/**
 * Mounted only while the whiteboard is actively pushing to a screen. Holds
 * the WS connection for that screenId and hands the parent a stable
 * `sendInteraction` via `sendRef` so pointer handlers (which fire far more
 * often than this component re-renders) don't need to prop-drill through
 * React state on every stroke point. Bidirectional: also forwards whatever
 * the gateway relays back (the CMS's own echo, or a stroke the TV drew) via
 * `onCommand`.
 */
export function WhiteboardScreenBridge({ screenId, sendRef, onStatusChange, onCommand }: WhiteboardScreenBridgeProps) {
  const wsUrl = process.env["NEXT_PUBLIC_WS_GATEWAY_URL"] ?? "/ws/";
  const { sendInteraction, status } = useScreenWebSocket({
    screenId,
    onContentUpdate: noop,
    onCommand,
    wsUrl,
    preview: true,
  });

  useEffect(() => {
    sendRef.current = sendInteraction;
    return () => {
      sendRef.current = noop;
    };
  }, [sendInteraction, sendRef]);

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  return null;
}
