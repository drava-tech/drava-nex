import { upgradeWebSocket } from "@hono/node-server"
import type { WSContext } from "hono/ws"
import {
  clientMessageSchema,
  type ScreenCommand,
  type ScreenContent,
  type ServerToAdminMessage,
  type ServerToScreenMessage,
  type Viewport,
} from "@workspace/types"

import { auth } from "../lib/auth"
import { hashDeviceToken } from "../lib/device-token"
import { resolveScreenContent } from "../services/content"
import { onAdminEvent, onScreenRevoked, onScreensChanged } from "../services/events"
import { pairing } from "../services/pairing"
import { setScreenPresence } from "../services/screens"

/**
 * The real-time hub. Two kinds of client share one endpoint (/ws):
 *
 *  - displays, which REGISTER with the device token they got at pairing;
 *  - console tabs, authenticated by their session cookie at upgrade time,
 *    which send ADMIN_REGISTER to receive live updates.
 *
 * Everything here is in memory and rebuilt from the database on restart: the
 * database decides what a screen shows; this module only delivers it.
 */

type Conn = {
  ws: WSContext
  kind: "pending" | "registering" | "screen" | "admin"
  screenId?: string
  /** Set by PONG; a socket that misses a whole heartbeat is closed. */
  alive: boolean
  closed: boolean
  /** Set at upgrade from the session cookie; null for displays. */
  userId: string | null
}

const screenConns = new Map<string, Set<Conn>>()
const adminConns = new Set<Conn>()
const contentCache = new Map<string, ScreenContent>()

/** 1008 = policy violation; 4401/4403 are ours ("unauthorized"/"revoked"). */
const CLOSE_UNAUTHORIZED = 4401
const CLOSE_REVOKED = 4403
const REGISTER_TIMEOUT_MS = 10_000
const MAX_MESSAGE_BYTES = 4096
/**
 * Must stay well under ~100 s: Cloudflare (and many proxies) drop a WebSocket
 * idle for that long. Without this heartbeat every display behind the tunnel
 * would silently disconnect and reconnect forever.
 */
const HEARTBEAT_MS = 30_000

function send(conn: Conn, message: ServerToScreenMessage | ServerToAdminMessage) {
  if (conn.closed) return
  try {
    conn.ws.send(JSON.stringify(message))
  } catch {
    // The socket is going away; its close handler cleans up.
  }
}

function close(conn: Conn, code: number, reason: string) {
  if (conn.closed) return
  conn.closed = true
  try {
    conn.ws.close(code, reason)
  } catch {
    // already closed
  }
}

export function connectedPlayerCount(screenId: string): number {
  return screenConns.get(screenId)?.size ?? 0
}

export function connectedScreenIds(): string[] {
  return [...screenConns.keys()]
}

function broadcastToAdmins(message: ServerToAdminMessage) {
  for (const conn of adminConns) send(conn, message)
}

function announceActiveScreens() {
  broadcastToAdmins({ type: "ACTIVE_SCREENS_LIST", screenIds: connectedScreenIds() })
}

// Let routes report live state without importing this module.
setScreenPresence({
  isOnline: (id) => connectedPlayerCount(id) > 0,
  currentContent: (id) => contentCache.get(id) ?? null,
})

/**
 * Re-resolves a screen's content from the database and delivers it.
 *
 * Always reports how many displays received it: `players: 0` means the change
 * was saved and sent and nothing changed on any wall — without this number a
 * dead panel and a working one look identical from the console.
 */
export async function pushContent(screenId: string): Promise<{ content: ScreenContent; players: number }> {
  const content = await resolveScreenContent(screenId)
  contentCache.set(screenId, content)
  const conns = screenConns.get(screenId) ?? new Set()
  for (const conn of conns) {
    send(conn, { type: "CONTENT_UPDATE", screenId, content, timestamp: Date.now() })
  }
  broadcastToAdmins({ type: "SCREEN_UPDATED", screenId, content })
  const players = conns.size
  if (players === 0) {
    console.warn(`[gateway] pushed to "${screenId}" but no display is connected — nothing changed on the wall`)
  }
  return { content, players }
}

/** Sends a remote command (reload, mute, blank…). Returns displays reached. */
export function sendScreenCommand(screenId: string, command: ScreenCommand): number {
  const conns = screenConns.get(screenId) ?? new Set()
  for (const conn of conns) send(conn, { type: "SCREEN_COMMAND", command, timestamp: Date.now() })
  return conns.size
}

/** Closes every socket a screen has open — its token was revoked. */
function revokeScreen(screenId: string) {
  const conns = screenConns.get(screenId)
  if (!conns) return
  for (const conn of conns) close(conn, CLOSE_REVOKED, "revoked")
  screenConns.delete(screenId)
  contentCache.delete(screenId)
  announceActiveScreens()
}

onAdminEvent(broadcastToAdmins)
onScreensChanged((ids) => {
  for (const id of ids) void pushContent(id).catch((err) => console.error(`[gateway] re-push ${id}:`, err))
})
onScreenRevoked(revokeScreen)

function describeViewport(v: Viewport | undefined): string {
  if (!v) return "no viewport"
  const physicalW = Math.round(v.innerW * v.dpr)
  const native = physicalW >= v.screenW * v.dpr * 0.98
  return `viewport ${v.innerW}x${v.innerH} @dpr ${v.dpr} on ${v.screenW}x${v.screenH} — ${native ? "native" : "UPSCALED"}`
}

async function registerScreen(conn: Conn, screenId: string, token: string, viewport: Viewport | undefined) {
  const screen = await pairing.findScreenByTokenHash(hashDeviceToken(token))
  // The socket may have gone while we waited on the database.
  if (conn.closed) return
  if (!screen || screen.id !== screenId) {
    send(conn, { type: "REGISTER_NACK", reason: "unauthorized" })
    close(conn, CLOSE_UNAUTHORIZED, "unauthorized")
    return
  }

  conn.kind = "screen"
  conn.screenId = screen.id
  let set = screenConns.get(screen.id)
  if (!set) screenConns.set(screen.id, (set = new Set()))
  set.add(conn)

  // The one piece of remote visibility into what a display really renders at.
  console.log(`[gateway] ${screen.id} "${screen.name}" connected — ${describeViewport(viewport)}`)

  // Always from the database, never the cache: whatever changed while this
  // display was offline must be what it wakes up to.
  const content = await resolveScreenContent(screen.id)
  if (conn.closed) return
  contentCache.set(screen.id, content)
  send(conn, { type: "REGISTER_ACK", screenId: screen.id, name: screen.name })
  send(conn, { type: "WELCOME", screenId: screen.id, content, blanked: screen.blanked })
  void pairing.markSeen(screen.id).catch(() => {})
  announceActiveScreens()
}

function handleMessage(conn: Conn, raw: string) {
  if (raw.length > MAX_MESSAGE_BYTES) return close(conn, 1009, "message too big")
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  const result = clientMessageSchema.safeParse(parsed)
  if (!result.success) return
  const msg = result.data

  switch (msg.type) {
    case "PONG":
      conn.alive = true
      return
    case "REGISTER":
      if (conn.kind !== "pending") return
      conn.kind = "registering" // a second REGISTER is ignored, never double-counted
      // Handled asynchronously on purpose: the handler itself stays
      // synchronous, so messages on every socket keep their order.
      void registerScreen(conn, msg.screenId, msg.token, msg.viewport).catch((err) => {
        console.error("[gateway] register failed:", err)
        close(conn, 1011, "server error")
      })
      return
    case "ADMIN_REGISTER":
      if (conn.kind !== "pending") return
      if (!conn.userId) {
        close(conn, CLOSE_UNAUTHORIZED, "sign in required")
        return
      }
      conn.kind = "admin"
      adminConns.add(conn)
      send(conn, { type: "ADMIN_ACK" })
      send(conn, { type: "ACTIVE_SCREENS_LIST", screenIds: connectedScreenIds() })
      return
  }
}

function handleClose(conn: Conn) {
  conn.closed = true
  if (conn.kind === "admin") adminConns.delete(conn)
  if (conn.kind === "screen" && conn.screenId) {
    const set = screenConns.get(conn.screenId)
    set?.delete(conn)
    if (set && set.size === 0) {
      screenConns.delete(conn.screenId)
      contentCache.delete(conn.screenId)
      console.log(`[gateway] ${conn.screenId} disconnected`)
      void pairing.markSeen(conn.screenId).catch(() => {})
      announceActiveScreens()
    }
  }
}

const allConns = new Set<Conn>()

setInterval(() => {
  for (const conn of allConns) {
    if (!conn.alive) {
      close(conn, 1001, "heartbeat timeout")
      continue
    }
    conn.alive = false
    send(conn, { type: "PING" })
  }
}, HEARTBEAT_MS).unref()

/** GET /ws — upgraded by @hono/node-server's built-in WebSocket support. */
export const wsRoute = upgradeWebSocket(async (c) => {
  // A console tab proves itself with its session cookie. Displays have none.
  const session = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null)
  const conn: Conn = { ws: undefined as unknown as WSContext, kind: "pending", alive: true, closed: false, userId: session?.user.id ?? null }
  let registerTimer: ReturnType<typeof setTimeout> | undefined

  return {
    onOpen(_event, ws) {
      conn.ws = ws
      allConns.add(conn)
      registerTimer = setTimeout(() => {
        if (conn.kind === "pending") close(conn, 1008, "register first")
      }, REGISTER_TIMEOUT_MS)
    },
    onMessage(event) {
      if (typeof event.data !== "string") return // no binary protocol
      handleMessage(conn, event.data)
    },
    onClose() {
      clearTimeout(registerTimer)
      allConns.delete(conn)
      handleClose(conn)
    },
    onError() {
      conn.closed = true
    },
  }
})
