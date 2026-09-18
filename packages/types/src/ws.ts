import { z } from "zod"

import type { ScreenContent } from "./content"

/**
 * WebSocket protocol. Flat JSON objects discriminated by `type` — no envelope.
 * Client → server messages are zod schemas because the gateway must validate
 * untrusted input; server → client messages are plain types.
 */

export const viewportSchema = z.object({
  dpr: z.number(),
  innerW: z.number(),
  innerH: z.number(),
  screenW: z.number(),
  screenH: z.number(),
})
export type Viewport = z.infer<typeof viewportSchema>

// ─── Client → server ─────────────────────────────────────────────────────────

export const clientMessageSchema = z.discriminatedUnion("type", [
  /** A display. The token comes from pairing; there is no unauthenticated path. */
  z.object({
    type: z.literal("REGISTER"),
    screenId: z.string(),
    token: z.string(),
    viewport: viewportSchema.optional(),
  }),
  /** A signed-in console tab. Authenticated by its session cookie at upgrade. */
  z.object({ type: z.literal("ADMIN_REGISTER") }),
  z.object({ type: z.literal("PONG") }),
])
export type ClientMessage = z.infer<typeof clientMessageSchema>

// ─── Server → display ────────────────────────────────────────────────────────

export type ScreenCommand = "RELOAD" | "MUTE" | "UNMUTE" | "SCREEN_BLANK" | "SCREEN_UNBLANK"

export type ServerToScreenMessage =
  | { type: "REGISTER_ACK"; screenId: string; name: string }
  | { type: "REGISTER_NACK"; reason: "unauthorized" | "invalid" }
  | { type: "WELCOME"; screenId: string; content: ScreenContent; blanked: boolean }
  | { type: "CONTENT_UPDATE"; screenId: string; content: ScreenContent; timestamp: number }
  | { type: "SCREEN_COMMAND"; command: ScreenCommand; timestamp: number }
  | { type: "PING" }

// ─── Server → console ────────────────────────────────────────────────────────

export type ServerToAdminMessage =
  | { type: "ADMIN_ACK" }
  | { type: "ACTIVE_SCREENS_LIST"; screenIds: string[] }
  | { type: "SCREEN_UPDATED"; screenId: string; content: ScreenContent }
  | { type: "SCREENS_CHANGED" }
  | { type: "MEDIA_LIBRARY_UPDATED" }
  | { type: "PING" }

export type ServerMessage = ServerToScreenMessage | ServerToAdminMessage
