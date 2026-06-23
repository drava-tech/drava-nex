"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { WsServerMessage, WsClientMessage, WsContent } from "@platform/types";
import { resolveBrowserWsUrl } from "@/lib/client-urls";

export type WsStatus = "connecting" | "connected" | "disconnected";

interface UseScreenWebSocketOptions {
  screenId: string;
  onContentUpdate: (content: WsContent) => void;
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
}

export function useScreenWebSocket({
  screenId,
  onContentUpdate,
  onCommand,
  wsUrl,
  preview = false,
}: UseScreenWebSocketOptions): UseScreenWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<WsStatus>("connecting");
  const onContentUpdateRef = useRef(onContentUpdate);
  onContentUpdateRef.current = onContentUpdate;
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;

  const connect = useCallback(() => {
    const resolved = resolveBrowserWsUrl(wsUrl);

    const ws = new WebSocket(resolved);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      setStatus("connected");
      const reg: WsClientMessage = { type: "REGISTER", screenId, preview };
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

  return { status, sendContentChangeRequest, sendInteraction };
}
