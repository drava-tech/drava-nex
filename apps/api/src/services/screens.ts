import { randomBytes } from "node:crypto"
import { screensRepo, type ScreenRow } from "@workspace/db"
import type { Screen, ScreenContent } from "@workspace/types"

import { db } from "../lib/db"

export const screens = screensRepo(db)

/** `scr_` + 16 hex. Server-generated: the id is also the WebSocket room key. */
export function newScreenId(): string {
  return `scr_${randomBytes(8).toString("hex")}`
}

/**
 * Live state that lives in the WebSocket gateway, not the database. Until the
 * gateway is attached (M10) every screen reports offline with no content.
 */
export type ScreenPresence = {
  isOnline(screenId: string): boolean
  currentContent(screenId: string): ScreenContent | null
}

let presence: ScreenPresence = {
  isOnline: () => false,
  currentContent: () => null,
}

export function setScreenPresence(next: ScreenPresence) {
  presence = next
}

export function toScreenDto(row: ScreenRow): Screen {
  return {
    id: row.id,
    name: row.name,
    paired: row.deviceTokenHash !== null,
    pairedAt: row.pairedAt?.toISOString() ?? null,
    online: presence.isOnline(row.id),
    blanked: row.blanked,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    content: presence.currentContent(row.id),
    currentMediaId: row.currentMediaId,
    defaultMediaId: row.defaultMediaId,
    queueMediaIds: row.queueMediaIds,
    queueIndex: row.queueIndex,
    createdAt: row.createdAt.toISOString(),
  }
}
