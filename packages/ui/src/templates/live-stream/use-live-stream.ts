"use client";

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { StreamFormat, WsClientMessage, WsServerMessage } from "@platform/types";

const RECONNECT_MS = 3_000;
const DEFAULT_CODEC = "avc1.42E01E";

/**
 * Resolves an env-style WS url (e.g. "/ws/" or "ws://host/ws/") to an absolute one.
 * Mirrors the screens app's resolveBrowserWsUrl, including the dev shortcut that
 * points the Next dev hosts (:3000/:3001) at the API on :4000.
 */
function resolveWsUrl(wsUrl: string): string {
  if (/^wss?:\/\//i.test(wsUrl)) return wsUrl;
  if (/^https?:\/\//i.test(wsUrl)) return wsUrl.replace(/^http/i, "ws");
  const path = wsUrl.startsWith("/") ? wsUrl : `/${wsUrl}`;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const { hostname, port, host } = window.location;
  const directDev =
    (hostname === "localhost" || hostname === "127.0.0.1") &&
    (port === "3000" || port === "3001");
  if (directDev && (path === "/ws" || path.startsWith("/ws/"))) {
    return `${proto}//${hostname}:4000${path}`;
  }
  return `${proto}//${host}${path}`;
}

interface UseLiveStreamResult {
  /** True while a publisher is connected AND at least one frame has painted. */
  live: boolean;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

/**
 * Subscribes to a live stream over the WebSocket gateway and decodes its binary
 * frames onto a <canvas>. H.264 frames are decoded with WebCodecs (sub-100ms);
 * MJPEG frames are decoded with createImageBitmap. Opaque to the rest of the app —
 * just point a <canvas> at `canvasRef` and read `live`.
 */
export function useLiveStream(streamId: string, wsUrl?: string): UseLiveStreamResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!streamId) return;

    const resolved = resolveWsUrl(wsUrl ?? "/ws/");

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    let decoder: VideoDecoder | null = null;
    let format: StreamFormat | undefined;
    let gotFrame = false;
    let awaitingKey = true; // skip delta frames until the first keyframe arrives

    const paint = (frame: CanvasImageSource, w: number, h: number) => {
      const canvas = canvasRef.current;
      if (!canvas || w === 0 || h === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(frame, 0, 0, w, h);
      if (!gotFrame) {
        gotFrame = true;
        setLive(true);
      }
    };

    const closeDecoder = () => {
      if (decoder && decoder.state !== "closed") {
        try {
          decoder.close();
        } catch {
          /* already gone */
        }
      }
      decoder = null;
      awaitingKey = true;
    };

    const ensureDecoder = (codec: string) => {
      closeDecoder();
      if (typeof VideoDecoder === "undefined") return;
      const d = new VideoDecoder({
        output: (frame: VideoFrame) => {
          paint(frame, frame.displayWidth, frame.displayHeight);
          frame.close();
        },
        error: () => closeDecoder(),
      });
      const config: VideoDecoderConfig = { codec };
      (config as VideoDecoderConfig & { optimizeForLatency?: boolean }).optimizeForLatency = true;
      d.configure(config);
      decoder = d;
      awaitingKey = true;
    };

    const handleBinary = (buf: ArrayBuffer) => {
      if (buf.byteLength < 9) return;
      const view = new DataView(buf);
      const frameType = view.getUint8(0);
      const timestamp = Number(view.getBigUint64(1, true));
      const payload = buf.slice(9);

      if (format === "mjpeg") {
        void createImageBitmap(new Blob([payload], { type: "image/jpeg" }))
          .then((bmp) => {
            paint(bmp, bmp.width, bmp.height);
            bmp.close();
          })
          .catch(() => {
            /* drop a corrupt frame */
          });
        return;
      }

      // H.264 via WebCodecs
      if (frameType === 0) {
        try {
          const cfg = JSON.parse(new TextDecoder().decode(payload)) as { codec?: string };
          ensureDecoder(cfg.codec ?? DEFAULT_CODEC);
        } catch {
          /* malformed config packet */
        }
        return;
      }
      if (!decoder || decoder.state !== "configured") return;
      if (frameType === 1) awaitingKey = false;
      if (awaitingKey) return;
      try {
        decoder.decode(
          new EncodedVideoChunk({
            type: frameType === 1 ? "key" : "delta",
            timestamp,
            data: payload,
          })
        );
      } catch {
        closeDecoder();
      }
    };

    const connect = () => {
      const sock = new WebSocket(resolved);
      sock.binaryType = "arraybuffer";
      ws = sock;

      sock.onopen = () => {
        const sub: WsClientMessage = { type: "STREAM_SUBSCRIBE", streamId };
        sock.send(JSON.stringify(sub));
      };

      sock.onmessage = (evt: MessageEvent) => {
        if (typeof evt.data === "string") {
          let msg: WsServerMessage;
          try {
            msg = JSON.parse(evt.data) as WsServerMessage;
          } catch {
            return;
          }
          if (msg.type === "STREAM_STATUS") {
            format = msg.format;
            if (!msg.active) {
              gotFrame = false;
              setLive(false);
              closeDecoder();
            }
          } else if (msg.type === "PING") {
            const pong: WsClientMessage = { type: "PONG" };
            sock.send(JSON.stringify(pong));
          }
          return;
        }
        if (evt.data instanceof ArrayBuffer) handleBinary(evt.data);
      };

      sock.onclose = () => {
        if (closed) return;
        gotFrame = false;
        setLive(false);
        closeDecoder();
        reconnectTimer = setTimeout(connect, RECONNECT_MS);
      };

      sock.onerror = () => sock.close();
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      closeDecoder();
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            const unsub: WsClientMessage = { type: "STREAM_UNSUBSCRIBE", streamId };
            ws.send(JSON.stringify(unsub));
          }
        } catch {
          /* socket already closing */
        }
        ws.close();
      }
    };
  }, [streamId, wsUrl]);

  return { live, canvasRef };
}
