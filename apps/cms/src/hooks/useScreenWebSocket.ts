"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { CameraStatusUpdate, WsServerMessage, WsClientMessage, WsContent } from "@platform/types";
import { resolveBrowserWsUrl } from "@/lib/display/client-urls";

export type WsStatus = "connecting" | "connected" | "disconnected";

interface UseScreenWebSocketOptions {
  screenId: string;
  onContentUpdate: (content: WsContent) => void;
  onCameraStatusUpdate?: (status: CameraStatusUpdate) => void;
  onCommand?: (command: string, value?: any) => void;
  wsUrl: string;
  /** Registers as a preview mirror (e.g. CMS embed) — excluded from online count. */
  preview?: boolean;
}

interface UseScreenWebSocketReturn {
  status: WsStatus;
  sendContentChangeRequest: (content: WsContent) => void;
  /** Relay a local interaction so every client of this screen applies it. */
  sendInteraction: (command: string, value?: unknown) => void;
  /** Send a raw client message (used by browser-based camera detection). */
  sendRaw: (msg: WsClientMessage) => void;
}

export function useScreenWebSocket({
  screenId,
  onContentUpdate,
  onCameraStatusUpdate,
  onCommand,
  wsUrl,
  preview = false,
}: UseScreenWebSocketOptions): UseScreenWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<WsStatus>("connecting");
  const onContentUpdateRef = useRef(onContentUpdate);
  onContentUpdateRef.current = onContentUpdate;
  const onCameraStatusUpdateRef = useRef(onCameraStatusUpdate);
  onCameraStatusUpdateRef.current = onCameraStatusUpdate;
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  // True once this hook has sent its first REGISTER. Persists across the
  // reconnect loop below (never a dep of `connect`) so only the very first
  // REGISTER of this JS context's lifetime — i.e. a real kiosk process
  // (re)start, since a page load/navigation always creates a fresh context —
  // carries freshLaunch: true. An ordinary reconnect after a network blip
  // within the same page load must NOT look like a fresh launch.
  const hasRegisteredRef = useRef(false);

  const connect = useCallback(() => {
    const resolved = resolveBrowserWsUrl(wsUrl);

    const ws = new WebSocket(resolved);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      setStatus("connected");
      const reg: WsClientMessage = {
        type: "REGISTER",
        screenId,
        preview,
        freshLaunch: !hasRegisteredRef.current,
      };
      hasRegisteredRef.current = true;
      ws.send(JSON.stringify(reg));
    };

    ws.onmessage = (evt: MessageEvent<string>) => {
      let msg: WsServerMessage;
      try {
        msg = JSON.parse(evt.data) as WsServerMessage;
      } catch {
        return;
      }

      if (msg.type === "CONTENT_UPDATE" || msg.type === "WELCOME") {
        onContentUpdateRef.current(msg.content);
      } else if (msg.type === "CAMERA_STATUS_UPDATE") {
        onCameraStatusUpdateRef.current?.(msg);
      } else if (msg.type === "PING") {
        const pong: WsClientMessage = { type: "PONG" };
        ws.send(JSON.stringify(pong));
      } else if (msg.type === "SCREEN_COMMAND") {
        onCommandRef.current?.(msg.command, msg.value);
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      reconnectRef.current = setTimeout(connect, 3_000);
    };

    ws.onerror = () => ws.close();
  }, [screenId, wsUrl, preview]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendContentChangeRequest = useCallback((content: WsContent) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: WsClientMessage = {
        type: "CONTENT_CHANGE_REQUEST",
        screenId,
        content,
      };
      ws.send(JSON.stringify(msg));
    }
  }, [screenId]);

  const sendInteraction = useCallback((command: string, value?: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const msg: WsClientMessage = { type: "SCREEN_INTERACTION", screenId, command, value };
      ws.send(JSON.stringify(msg));
    }
  }, [screenId]);

  /**
   * Send a raw client message over the same connection the screen already
   * holds — used by browser-based camera detection (CAMERA_REGISTER,
   * CAMERA_HEARTBEAT, PRODUCT_DETECTED, PRODUCT_LOST), which now owns the
   * full camera-lifecycle responsibility the native Python service used to.
   */
  const sendRaw = useCallback((msg: WsClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  return { status, sendContentChangeRequest, sendInteraction, sendRaw };
}
