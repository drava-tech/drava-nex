"use client";

import { useEffect, useRef, useCallback } from "react";
import type { WsClientMessage, WsCmsMessage, WsContent } from "@platform/types";

interface UseCmsScreenSyncOptions {
  onScreenUpdated: (screenId: string, content: WsContent) => void;
}

export function useCmsScreenSync({ onScreenUpdated }: UseCmsScreenSyncOptions): void {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScreenUpdatedRef = useRef(onScreenUpdated);
  onScreenUpdatedRef.current = onScreenUpdated;

  const connect = useCallback(() => {
    const wsUrl = process.env["NEXT_PUBLIC_WS_GATEWAY_URL"] ?? "/ws/";
    const resolved = wsUrl.startsWith("/")
      ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${wsUrl}`
      : wsUrl;

    const ws = new WebSocket(resolved);
    wsRef.current = ws;

    ws.onopen = () => {
      const reg: WsClientMessage = { type: "CMS_REGISTER" };
      ws.send(JSON.stringify(reg));
    };

    ws.onmessage = (evt: MessageEvent<string>) => {
      let msg: WsCmsMessage;
      try {
        msg = JSON.parse(evt.data) as WsCmsMessage;
      } catch {
        return;
      }
      if (msg.type === "SCREEN_UPDATED") {
        onScreenUpdatedRef.current(msg.screenId, msg.content);
      }
    };

    ws.onclose = () => {
      reconnectRef.current = setTimeout(connect, 3_000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
