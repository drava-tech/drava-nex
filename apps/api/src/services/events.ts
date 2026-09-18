import { EventEmitter } from "node:events"
import type { ServerToAdminMessage } from "@workspace/types"

/**
 * In-process fan-out of "something changed" events to signed-in console tabs.
 * Routes emit; the WebSocket gateway (M10) subscribes and forwards. Keeping
 * this seam means routes never import the gateway.
 */
const bus = new EventEmitter()
bus.setMaxListeners(50)

export function notifyAdmins(message: ServerToAdminMessage) {
  bus.emit("admin", message)
}

export function onAdminEvent(listener: (message: ServerToAdminMessage) => void) {
  bus.on("admin", listener)
  return () => bus.off("admin", listener)
}

/**
 * Screens whose assigned content changed outside a push (e.g. their media was
 * deleted). The gateway re-resolves and re-pushes them.
 */
export function notifyScreensChanged(screenIds: string[]) {
  if (screenIds.length) bus.emit("screens-changed", screenIds)
}

export function onScreensChanged(listener: (screenIds: string[]) => void) {
  bus.on("screens-changed", listener)
  return () => bus.off("screens-changed", listener)
}
