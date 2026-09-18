import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import type { ServerToAdminMessage } from "@workspace/types"

import { wsUrl } from "@/lib/ws-url"

export type LiveStatus = "connecting" | "live" | "offline"

/**
 * Keeps the console current without polling: one socket per tab, authenticated
 * by the session cookie, turning server events into cache invalidations.
 */
export function useLiveUpdates(): LiveStatus {
  const qc = useQueryClient()
  const [status, setStatus] = useState<LiveStatus>("connecting")

  useEffect(() => {
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let attempt = 0
    let stopped = false

    const connect = () => {
      setStatus(attempt === 0 ? "connecting" : "offline")
      ws = new WebSocket(wsUrl())
      ws.onopen = () => ws?.send(JSON.stringify({ type: "ADMIN_REGISTER" }))
      ws.onmessage = (event) => {
        let msg: ServerToAdminMessage
        try {
          msg = JSON.parse(event.data as string) as ServerToAdminMessage
        } catch {
          return
        }
        switch (msg.type) {
          case "ADMIN_ACK":
            attempt = 0
            setStatus("live")
            // Anything may have changed while we were disconnected.
            void qc.invalidateQueries()
            break
          case "PING":
            ws?.send(JSON.stringify({ type: "PONG" }))
            break
          case "ACTIVE_SCREENS_LIST":
          case "SCREEN_UPDATED":
          case "SCREENS_CHANGED":
            void qc.invalidateQueries({ queryKey: ["screens"] })
            break
          case "MEDIA_LIBRARY_UPDATED":
            void qc.invalidateQueries({ queryKey: ["media"] })
            break
        }
      }
      ws.onclose = (event) => {
        if (stopped) return
        setStatus("offline")
        // 4401: the session is gone — reconnecting will not help until sign-in.
        if (event.code === 4401) return
        const delay = Math.min(10_000, 1000 * 2 ** attempt++)
        retry = setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      stopped = true
      clearTimeout(retry)
      // Closing a socket that is still connecting logs an error in the browser
      // (React StrictMode mounts twice in dev); let it open, then close it.
      if (ws?.readyState === WebSocket.CONNECTING) ws.onopen = () => ws?.close()
      else ws?.close()
    }
  }, [qc])

  return status
}
