"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { WsClientMessage, WsServerMessage } from "@platform/types";

const RECONNECT_MS = 3_000;

/**
 * Resolves an env-style WS url to an absolute one. Single-origin: an absolute URL
 * is used as-is; otherwise the path is same-origin (nginx routes /ws to the API).
 * Copied from templates/live-stream/use-live-stream.ts rather than shared — it's
 * four lines and importing across sibling feature folders isn't worth the coupling.
 */
function resolveWsUrl(wsUrl: string): string {
  if (/^wss?:\/\//i.test(wsUrl)) return wsUrl;
  if (/^https?:\/\//i.test(wsUrl)) return wsUrl.replace(/^http/i, "ws");
  const path = wsUrl.startsWith("/") ? wsUrl : `/${wsUrl}`;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}

type BrowserControlAction = Extract<WsClientMessage, { type: "BROWSER_CONTROL" }>["action"];

function randomSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export interface UseBrowserSessionOptions {
  /** False for a screen's kiosk render — no click/navigate controls are sent. */
  interactive: boolean;
  /**
   * Fixed stream id instead of a random one. Kiosk sessions pass a deterministic
   * id derived from the media asset so every screen showing the same pushed page
   * shares one Puppeteer page and one screencast, instead of one each.
   */
  sessionId?: string;
  wsUrl?: string;
  /** Render resolution — defaults to the render service's own default (1280x720) when omitted. */
  viewport?: { width: number; height: number };
}

export interface UseBrowserSessionResult {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** True once the renderer has confirmed the page loaded and frames are flowing. */
  ready: boolean;
  error: string | null;
  /** Renderer-reported current URL — reflects in-page navigation, not just the omnibox. */
  url: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Navigate the already-open session (does not open a new Puppeteer page). */
  navigate: (url: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  /** Client-space coordinates — converted through the canvas's bounding rect. */
  click: (clientX: number, clientY: number) => void;
  scroll: (deltaY: number) => void;
  sendKey: (key: string) => void;
  type: (text: string) => void;
}

/**
 * Opens (or joins) a headless-Chromium render session over the platform's
 * existing WS gateway and paints its MJPEG screencast onto a canvas. Frame
 * delivery reuses the gateway's live-stream STREAM_SUBSCRIBE/binary-relay path
 * unchanged (see templates/live-stream/use-live-stream.ts, the H.264/WebCodecs
 * sibling of this — browser-render only ever publishes MJPEG, so that branch
 * doesn't apply here). Control (click/scroll/type/navigate) rides the same
 * socket as BROWSER_CONTROL messages, forwarded by the gateway to
 * services/browser-render.
 *
 * `initialUrl` is only used to open the session — call `navigate()` for every
 * URL change afterward so one Puppeteer page persists across navigations
 * instead of a fresh page being spun up each time.
 */
export function useBrowserSession(
  initialUrl: string | null,
  opts: UseBrowserSessionOptions
): UseBrowserSessionResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const [sessionId] = useState(opts.sessionId ?? randomSessionId());

  const sendControl = useCallback(
    (action: BrowserControlAction, extra: Record<string, unknown> = {}) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const msg: WsClientMessage = { type: "BROWSER_CONTROL", sessionId, action, ...extra } as WsClientMessage;
      ws.send(JSON.stringify(msg));
    },
    [sessionId]
  );

  useEffect(() => {
    if (!initialUrl) return;

    // A bare relative "/ws/" only works if a dev-server rewrite proxy handles
    // the WebSocket upgrade correctly, which is inconsistent — every other WS
    // consumer in this app instead connects straight to the absolute gateway
    // URL. Match that convention here too, rather than silently depending on
    // rewrite proxying no other feature relies on.
    const resolved = resolveWsUrl(
      opts.wsUrl ?? process.env["NEXT_PUBLIC_WS_GATEWAY_URL"] ?? "/ws/"
    );
    let closed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let decoding = false; // drop frames while a previous decode is still in flight

    const paint = (bmp: ImageBitmap) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (canvas.width !== bmp.width || canvas.height !== bmp.height) {
        canvas.width = bmp.width;
        canvas.height = bmp.height;
      }
      ctx.drawImage(bmp, 0, 0, bmp.width, bmp.height);
    };

    const handleBinary = (buf: ArrayBuffer) => {
      if (buf.byteLength < 9 || decoding) return;
      const payload = buf.slice(9); // [frameType][8-byte ts] header, JPEG payload
      decoding = true;
      void createImageBitmap(new Blob([payload], { type: "image/jpeg" }))
        .then((bmp) => {
          paint(bmp);
          bmp.close();
        })
        .catch(() => {
          /* drop a corrupt frame */
        })
        .finally(() => {
          decoding = false;
        });
    };

    const connect = () => {
      const sock = new WebSocket(resolved);
      sock.binaryType = "arraybuffer";
      wsRef.current = sock;

      sock.onopen = () => {
        setError(null);
        const start: WsClientMessage = {
          type: "BROWSER_SESSION_START",
          sessionId,
          url: initialUrl,
          interactive: opts.interactive,
          ...(opts.viewport ? { viewport: opts.viewport } : {}),
        };
        sock.send(JSON.stringify(start));
      };

      sock.onmessage = (evt: MessageEvent) => {
        if (evt.data instanceof ArrayBuffer) {
          handleBinary(evt.data);
          return;
        }
        let msg: WsServerMessage;
        try {
          msg = JSON.parse(evt.data) as WsServerMessage;
        } catch {
          return;
        }
        switch (msg.type) {
          case "BROWSER_SESSION_READY": {
            const sub: WsClientMessage = { type: "STREAM_SUBSCRIBE", streamId: sessionId };
            sock.send(JSON.stringify(sub));
            setReady(true);
            setUrl(initialUrl);
            break;
          }
          case "BROWSER_SESSION_ERROR":
            setError(msg.message);
            setReady(false);
            break;
          case "BROWSER_URL_CHANGED":
            setUrl(msg.url);
            setCanGoBack(msg.canGoBack);
            setCanGoForward(msg.canGoForward);
            break;
          case "PING": {
            const pong: WsClientMessage = { type: "PONG" };
            sock.send(JSON.stringify(pong));
            break;
          }
        }
      };

      sock.onclose = () => {
        setReady(false);
        if (closed) return;
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };

      sock.onerror = () => sock.close();
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        const stop: WsClientMessage = { type: "BROWSER_SESSION_STOP", sessionId };
        ws.send(JSON.stringify(stop));
      }
      ws?.close();
      wsRef.current = null;
    };
    // Intentionally mount-once: `initialUrl` only opens the session. Subsequent
    // navigation goes through navigate(), not a prop change / remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, opts.interactive]);

  const navigate = useCallback((next: string) => sendControl("navigate", { url: next }), [sendControl]);
  const goBack = useCallback(() => sendControl("back"), [sendControl]);
  const goForward = useCallback(() => sendControl("forward"), [sendControl]);
  const reload = useCallback(() => sendControl("reload"), [sendControl]);
  const scroll = useCallback((deltaY: number) => sendControl("scroll", { deltaY }), [sendControl]);
  const sendKey = useCallback((key: string) => sendControl("key", { key }), [sendControl]);
  const type = useCallback((text: string) => sendControl("type", { text }), [sendControl]);

  const click = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * canvas.width;
      const y = ((clientY - rect.top) / rect.height) * canvas.height;
      sendControl("click", { x, y });
    },
    [sendControl]
  );

  return { canvasRef, ready, error, url, canGoBack, canGoForward, navigate, goBack, goForward, reload, click, scroll, sendKey, type };
}
