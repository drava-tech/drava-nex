// The load-bearing core of cms-platform's useScreenWebSocket.ts (unmount
// guard, reconnect loop, PING/PONG, viewport report), reduced to this
// product's protocol and extended for authenticated registration.

import { useEffect, useRef, useState } from "react"
import type { ScreenCommand, ScreenContent, ServerToScreenMessage } from "@workspace/types"

import { wsUrl } from "@/lib/ws-url"

export type SocketStatus = "connecting" | "connected" | "disconnected"

type Options = {
  screenId: string
  token: string
  onContent: (content: ScreenContent) => void
  onWelcome: (content: ScreenContent, blanked: boolean) => void
  onCommand: (command: ScreenCommand) => void
  /** The server says this display's token is no longer valid. Stop for good. */
  onRevoked: () => void
}

/** 4401 = unauthorized, 4403 = revoked (see the gateway). */
const REVOKED_CODES = new Set([4401, 4403])

export function useScreenSocket(opts: Options): SocketStatus {
  const [status, setStatus] = useState<SocketStatus>("connecting")
  const cb = useRef(opts)
  cb.current = opts

  useEffect(() => {
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    // `onclose` fires after cleanup has cleared the pending reconnect; without
    // this flag an unmounted hook would schedule a connect() nothing cancels.
    let closed = false

    const connect = () => {
      setStatus("connecting")
      ws = new WebSocket(wsUrl())
      ws.onopen = () => {
        ws?.send(
          JSON.stringify({
            type: "REGISTER",
            screenId: opts.screenId,
            token: opts.token,
            // Diagnostic only: lets the server log whether the panel renders at
            // its native resolution.
            viewport: {
              dpr: window.devicePixelRatio,
              innerW: window.innerWidth,
              innerH: window.innerHeight,
              screenW: window.screen.width,
              screenH: window.screen.height,
            },
          })
        )
      }
      ws.onmessage = (event) => {
        let msg: ServerToScreenMessage
        try {
          msg = JSON.parse(event.data as string) as ServerToScreenMessage
        } catch {
          return
        }
        switch (msg.type) {
          case "REGISTER_ACK":
            attempt = 0
            setStatus("connected")
            break
          case "WELCOME":
            cb.current.onWelcome(msg.content, msg.blanked)
            break
          case "CONTENT_UPDATE":
            cb.current.onContent(msg.content)
            break
          case "SCREEN_COMMAND":
            cb.current.onCommand(msg.command)
            break
          case "PING":
            ws?.send(JSON.stringify({ type: "PONG" }))
            break
        }
      }
      ws.onclose = (event) => {
        if (closed) return
        setStatus("disconnected")
        if (REVOKED_CODES.has(event.code)) {
          cb.current.onRevoked()
          return
        }
        // 1 s, 2 s, 4 s … capped at 15 s, so a restarting server is not hammered.
        retry = setTimeout(connect, Math.min(15_000, 1000 * 2 ** attempt++))
      }
      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      closed = true
      clearTimeout(retry)
      // Closing a socket that is still connecting logs an error in the browser
      // (React StrictMode mounts twice in dev); let it open, then close it.
      if (ws?.readyState === WebSocket.CONNECTING) ws.onopen = () => ws?.close()
      else ws?.close()
    }
  }, [opts.screenId, opts.token])

  return status
}
