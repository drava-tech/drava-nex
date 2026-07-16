"use client";

import { useEffect, useRef, useCallback } from "react";
import type { CameraStatusUpdate, WsClientMessage, WsContent } from "@platform/types";
import { resolveBrowserWsUrl } from "@/lib/display/client-urls";

export interface VisitorDetectedEvent {
  uuid: string;
  name: string;
  isNew: boolean;
  lastSeen: string;
  hasImage: boolean;
}

interface UseCmsScreenSyncOptions {
  onScreenUpdated?: (screenId: string, content: WsContent) => void;
  onActiveScreensUpdated?: (activeScreenIds: string[]) => void;
  onCameraStatusUpdated?: (status: CameraStatusUpdate) => void;
  onVisitorDetected?: (visitor: VisitorDetectedEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export function useCmsScreenSync({
  onScreenUpdated,
  onActiveScreensUpdated,
  onCameraStatusUpdated,
  onVisitorDetected,
  onConnectionChange,
}: UseCmsScreenSyncOptions): void {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const onScreenUpdatedRef = useRef(onScreenUpdated);
  onScreenUpdatedRef.current = onScreenUpdated;
  
  const onActiveScreensUpdatedRef = useRef(onActiveScreensUpdated);
  onActiveScreensUpdatedRef.current = onActiveScreensUpdated;
  const onCameraStatusUpdatedRef = useRef(onCameraStatusUpdated);
  onCameraStatusUpdatedRef.current = onCameraStatusUpdated;
  const onVisitorDetectedRef = useRef(onVisitorDetected);
  onVisitorDetectedRef.current = onVisitorDetected;
  const onConnectionChangeRef = useRef(onConnectionChange);
  onConnectionChangeRef.current = onConnectionChange;

  const connect = useCallback(() => {
    const wsUrl = process.env["NEXT_PUBLIC_WS_GATEWAY_URL"] ?? "/ws/";
    const resolved = resolveBrowserWsUrl(wsUrl);

    const ws = new WebSocket(resolved);
    wsRef.current = ws;

    ws.onopen = () => {
      const reg: WsClientMessage = { type: "CMS_REGISTER" };
      ws.send(JSON.stringify(reg));
      onConnectionChangeRef.current?.(true);
    };

    ws.onmessage = (evt: MessageEvent<string>) => {
      let msg: any;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.type === "SCREEN_UPDATED") {
        onScreenUpdatedRef.current?.(msg.screenId, msg.content);
      } else if (msg.type === "ACTIVE_SCREENS_LIST") {
        onActiveScreensUpdatedRef.current?.(msg.activeScreenIds);
      } else if (msg.type === "CAMERA_STATUS_UPDATE") {
        onCameraStatusUpdatedRef.current?.(msg);
      } else if (msg.type === "VISITOR_DETECTED") {
        onVisitorDetectedRef.current?.({
          uuid: msg.uuid,
          name: msg.name,
          isNew: msg.isNew,
          lastSeen: msg.lastSeen,
          hasImage: msg.hasImage,
        });
      }
    };

    ws.onclose = () => {
      onConnectionChangeRef.current?.(false);
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
