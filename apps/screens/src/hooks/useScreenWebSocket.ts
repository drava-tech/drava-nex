"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { WsServerMessage, WsClientMessage, WsContent } from "@platform/types";

export type WsStatus = "connecting" | "connected" | "disconnected";

interface UseScreenWebSocketOptions {
  screenId: string;
  onContentUpdate: (content: WsContent) => void;
  wsUrl: string;
}

interface UseScreenWebSocketReturn {
  status: WsStatus;
  sendContentChangeRequest: (content: WsContent) => void;
}

export function useScreenWebSocket({
  screenId,
  onContentUpdate,
  wsUrl,
}: UseScreenWebSocketOptions): UseScreenWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<WsStatus>("connecting");
  const onContentUpdateRef = useRef(onContentUpdate);
  onContentUpdateRef.current = onContentUpdate;

  const connect = useCallback(() => {
    const resolved = wsUrl.startsWith("/")
      ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${wsUrl}`
      : wsUrl;

    const ws = new WebSocket(resolved);
    wsRef.current = ws;
    setStatus("connecting");

    ws.onopen = () => {
      setStatus("connected");
      const reg: WsClientMessage = { type: "REGISTER", screenId };
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
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
      reconnectRef.current = setTimeout(connect, 3_000);
    };

    ws.onerror = () => ws.close();
  }, [screenId, wsUrl]);

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

  return { status, sendContentChangeRequest };
}
