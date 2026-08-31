"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WsClientMessage } from "@platform/types";
import { resolveBrowserWsUrl } from "@/lib/display/client-urls";

interface UseScreenCursorControlReturn {
  /** null = no SCREEN_AGENT_STATUS received yet (unknown), otherwise whether
   * this screen's native agent (apps/api/screen-agent) is currently connected. */
  agentOnline: boolean | null;
  moveCursor: (dx: number, dy: number) => void;
  click: (button?: "left" | "right") => void;
  scroll: (deltaY: number) => void;
}

/**
 * Drives the REAL OS-level mouse cursor on the Windows PC physically driving
 * a screen's TV, via its registered native screen-agent — see
 * apps/api/screen-agent/agent.mjs and gateway.ts's screenAgentRegistry. Opens
 * its own CMS_REGISTER connection (same pattern as useCmsScreenSync), since
 * CURSOR_CONTROL is a fire-and-forget relay independent of any screen's own
 * REGISTER connection.
 */
export function useScreenCursorControl(screenId: string): UseScreenCursorControlReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    function connect() {
      const wsUrl = process.env["NEXT_PUBLIC_WS_GATEWAY_URL"] ?? "/ws/";
      const ws = new WebSocket(resolveBrowserWsUrl(wsUrl));
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
        if (msg.type === "SCREEN_AGENT_STATUS" && msg.screenId === screenId) {
          setAgentOnline(msg.connected);
        }
      };

      ws.onclose = () => {
        if (stopped) return;
        setAgentOnline(null);
        reconnectTimer = setTimeout(connect, 3_000);
      };

      ws.onerror = () => ws.close();
    }

    connect();
    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [screenId]);

  const send = useCallback((msg: WsClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const moveCursor = useCallback(
    (dx: number, dy: number) => send({ type: "CURSOR_CONTROL", screenId, action: "move", dx, dy }),
    [send, screenId]
  );

  const click = useCallback(
    (button?: "left" | "right") => send({ type: "CURSOR_CONTROL", screenId, action: "click", button }),
    [send, screenId]
  );

  const scroll = useCallback(
    (deltaY: number) => send({ type: "CURSOR_CONTROL", screenId, action: "scroll", deltaY }),
    [send, screenId]
  );

  return { agentOnline, moveCursor, click, scroll };
}
