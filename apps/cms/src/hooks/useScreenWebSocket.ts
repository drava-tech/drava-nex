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
  // See the identical flag in useCmsScreenSync.ts. `onclose` fires after the
  // effect cleanup has already cleared the pending reconnect timer, so without
  // this an unmounted hook scheduled a connect() nothing could cancel. That
  // mattered most on the publish round trip (board -> live page -> back), which
  // stranded an immortal `preview` socket per cycle — inflating the screen
  // registry and amplifying every drag-progress frame across the zombies.
  const closedRef = useRef(false);
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
  // …but a fresh JS context alone is too broad: pressing F5 on the wall builds
  // one too, and the gateway answers freshLaunch by wiping the screen's
  // assignment back to idle (gateway.ts, resetScreenToIdle). A refresh has to
  // keep what is on the wall; only genuinely (re)opening the URL — a kiosk
  // process start, or closing the tab and going back to it — should come up
  // clean. Navigation Timing is what separates the two. A browser that doesn't
  // report an entry falls back to the old behaviour rather than never
  // resetting.
  const openedFresh = useRef(true);
  if (typeof performance !== "undefined") {
    const navType = (
      performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
    )?.type;
    if (navType === "reload" || navType === "back_forward") openedFresh.current = false;

    // Navigation Timing alone is not enough. The kiosk shell recovers from a
    // WebView2 renderer crash by calling Navigate(TargetUrl) again, which
    // reports type "navigate" — indistinguishable from a genuine first open —
    // so a crashed-and-recovered panel would hard-reset itself to idle. A React
    // remount (error boundary, Suspense retry) has the same effect on the refs
    // above without any document load at all.
    //
    // sessionStorage is scoped to the tab and survives both, so it records that
    // THIS screen has already registered once here. Wrapped because a WebView
    // with site data disabled throws on access, and the correct fallback is the
    // Navigation Timing answer above, not a crash.
    try {
      const key = `screen-registered:${screenId}`;
      if (window.sessionStorage.getItem(key)) {
        openedFresh.current = false;
      } else {
        window.sessionStorage.setItem(key, "1");
      }
    } catch {
      /* storage unavailable — fall back to Navigation Timing alone */
    }
  }

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
        freshLaunch: !hasRegisteredRef.current && openedFresh.current,
        // Diagnostic only — see the field's docblock in @platform/types.
        // Skipped for previews, whose viewport is an iframe in a CMS layout
        // and says nothing about the physical panel.
        ...(preview
          ? {}
          : {
              viewport: {
                dpr: window.devicePixelRatio,
                innerW: window.innerWidth,
                innerH: window.innerHeight,
                screenW: window.screen.width,
                screenH: window.screen.height,
              },
            }),
      };
      // Set BEFORE the send, and note the flag is computed above: if the first
      // connection attempt never succeeds — which is exactly what happens while
      // the API is restarting — the reconnect that eventually lands must not
      // still look like a fresh launch and wipe the screen.
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
      if (closedRef.current) return; // unmounted — do not resurrect
      setStatus("disconnected");
      reconnectRef.current = setTimeout(connect, 3_000);
    };

    ws.onerror = () => ws.close();
  }, [screenId, wsUrl, preview]);

  useEffect(() => {
    closedRef.current = false;
    connect();
    return () => {
      closedRef.current = true;
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
