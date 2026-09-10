"use client";

import { useEffect, type MutableRefObject } from "react";
import { useScreenWebSocket } from "@/hooks/useScreenWebSocket";

const noop = () => {};

interface PublishScreenBridgeProps {
  screenId: string;
  /** Populated with the live `sendInteraction` fn once connected; cleared on unmount. */
  sendRef: MutableRefObject<(command: string, value?: unknown) => void>;
}

/**
 * Send-only WS connection scoped to the current publish target, giving
 * SwipeCard a way to stream PUBLISH_DRAG_* commands to that screen without
 * prop-drilling through React state on every drag frame. Unlike
 * WhiteboardScreenBridge this never passes onCommand — the publish-board
 * page never needs to react to its own echoed drag commands (only the
 * display route's PublishDragOverlay listens for them).
 */
export function PublishScreenBridge({ screenId, sendRef }: PublishScreenBridgeProps) {
  const wsUrl = process.env["NEXT_PUBLIC_WS_GATEWAY_URL"] ?? "/ws/";
  const { sendInteraction } = useScreenWebSocket({
    screenId,
    onContentUpdate: noop,
    wsUrl,
    preview: true,
  });

  useEffect(() => {
    sendRef.current = sendInteraction;
    return () => {
      sendRef.current = noop;
    };
  }, [sendInteraction, sendRef]);

  return null;
}
