"use client";

import { useEffect, useRef, useCallback } from "react";
import type { CameraStatusUpdate, WsClientMessage, WsContent } from "@platform/types";
import { resolveBrowserWsUrl } from "@/lib/display/client-urls";

interface UseCmsScreenSyncOptions {
  onScreenUpdated: (screenId: string, content: WsContent) => void;
  onActiveScreensUpdated?: (activeScreenIds: string[]) => void;
  onCameraStatusUpdated?: (status: CameraStatusUpdate) => void;
}

export function useCmsScreenSync({
  onScreenUpdated,
  onActiveScreensUpdated,
  onCameraStatusUpdated,
}: UseCmsScreenSyncOptions): void {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const onScreenUpdatedRef = useRef(onScreenUpdated);
  onScreenUpdatedRef.current = onScreenUpdated;
  
  const onActiveScreensUpdatedRef = useRef(onActiveScreensUpdated);
  onActiveScreensUpdatedRef.current = onActiveScreensUpdated;
  const onCameraStatusUpdatedRef = useRef(onCameraStatusUpdated);
  onCameraStatusUpdatedRef.current = onCameraStatusUpdated;

  const connect = useCallback(() => {
    const wsUrl = process.env["NEXT_PUBLIC_WS_GATEWAY_URL"] ?? "/ws/";
    const resolved = resolveBrowserWsUrl(wsUrl);

    const ws = new WebSocket(resolved);
    wsRef.current = ws;

    ws.onopen = () => {
      const reg: WsClientMessage = { type: "CMS_REGISTER" };
      ws.send(JSON.stringify(reg));
    };

    ws.onmessage = (evt: MessageEvent<string>) => {
      let msg: any;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.type === "SCREEN_UPDATED") {
        onScreenUpdatedRef.current(msg.screenId, msg.content);
      } else if (msg.type === "ACTIVE_SCREENS_LIST") {
        onActiveScreensUpdatedRef.current?.(msg.activeScreenIds);
      } else if (msg.type === "CAMERA_STATUS_UPDATE") {
        onCameraStatusUpdatedRef.current?.(msg);
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
