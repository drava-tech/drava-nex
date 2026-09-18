import { z } from "zod"

/**
 * What a screen can render. Deliberately small: this product pushes media, not
 * experiences or templates.
 *
 * - `image` / `video` — played natively; `source` is the media URL.
 * - `html` — a full-screen iframe: a pasted web link, or one of the document
 *   viewers (`/display/pdf?src=…` etc.).
 * - `idle` — nothing assigned; the screen shows its idle state.
 */
export const contentTypeSchema = z.enum(["image", "video", "html", "idle"])
export type ContentType = z.infer<typeof contentTypeSchema>

export const screenContentSchema = z.object({
  id: z.string(),
  type: contentTypeSchema,
  source: z.string(),
  loop: z.boolean().optional(),
  muted: z.boolean().optional(),
  title: z.string().optional(),
})
export type ScreenContent = z.infer<typeof screenContentSchema>

export const IDLE_CONTENT: ScreenContent = { id: "__idle__", type: "idle", source: "" }

/**
 * Screen ids double as the WebSocket room key, so they are generated server-side
 * and never chosen by a client.
 */
export const SCREEN_ID_PATTERN = /^scr_[0-9a-f]{16}$/
export const screenIdSchema = z.string().regex(SCREEN_ID_PATTERN, "Invalid screen id")
