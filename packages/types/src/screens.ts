import { z } from "zod"

import { screenContentSchema } from "./content"

export const screenSchema = z.object({
  id: z.string(),
  name: z.string(),
  paired: z.boolean(),
  pairedAt: z.string().nullable(),
  online: z.boolean(),
  blanked: z.boolean(),
  lastSeenAt: z.string().nullable(),
  content: screenContentSchema.nullable(),
  currentMediaId: z.string().nullable(),
  defaultMediaId: z.string().nullable(),
  queueMediaIds: z.array(z.string()),
  queueIndex: z.number(),
  createdAt: z.string(),
})
export type Screen = z.infer<typeof screenSchema>

export const createScreenRequestSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
})
export type CreateScreenRequest = z.infer<typeof createScreenRequestSchema>

export const renameScreenRequestSchema = createScreenRequestSchema
export type RenameScreenRequest = CreateScreenRequest

// ─── Pairing ─────────────────────────────────────────────────────────────────

/** No 0/O, 1/I/L or U — a code read aloud across a room must survive it. */
export const PAIRING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
export const PAIRING_CODE_LENGTH = 6

export const pairingCodeResponseSchema = z.object({
  code: z.string(),
  expiresAt: z.string(),
})
export type PairingCodeResponse = z.infer<typeof pairingCodeResponseSchema>

export const pairRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .length(PAIRING_CODE_LENGTH)
    .refine((c) => [...c].every((ch) => PAIRING_ALPHABET.includes(ch)), "Invalid code"),
})
export type PairRequest = z.infer<typeof pairRequestSchema>

export const pairResponseSchema = z.object({
  screenId: z.string(),
  name: z.string(),
  /** Returned exactly once. The server keeps only its hash. */
  token: z.string(),
})
export type PairResponse = z.infer<typeof pairResponseSchema>

// ─── Push controls ───────────────────────────────────────────────────────────

export const pushMediaRequestSchema = z.object({
  /** null clears the screen back to its default item (or idle). */
  mediaId: z.string().min(1).nullable(),
})
export type PushMediaRequest = z.infer<typeof pushMediaRequestSchema>

export const pushQueueRequestSchema = z.object({
  mediaIds: z.array(z.string().min(1)).min(1).max(200),
  startIndex: z.number().int().min(0).default(0),
})
export type PushQueueRequest = z.infer<typeof pushQueueRequestSchema>

export const navigateQueueRequestSchema = z.object({
  direction: z.enum(["next", "prev"]),
})
export type NavigateQueueRequest = z.infer<typeof navigateQueueRequestSchema>

export const defaultMediaRequestSchema = z.object({
  mediaId: z.string().min(1).nullable(),
})
export type DefaultMediaRequest = z.infer<typeof defaultMediaRequestSchema>

export const blankRequestSchema = z.object({ blanked: z.boolean() })
export type BlankRequest = z.infer<typeof blankRequestSchema>

export const screenCommandRequestSchema = z.object({
  command: z.enum(["RELOAD", "MUTE", "UNMUTE"]),
})
export type ScreenCommandRequest = z.infer<typeof screenCommandRequestSchema>

/**
 * Every push reports how many displays actually received it. `players: 0`
 * means the assignment was saved and broadcast, and nothing changed on any
 * wall — a dead panel otherwise looks exactly like a working one.
 */
export const pushResultSchema = z.object({
  screenId: z.string(),
  content: screenContentSchema,
  players: z.number(),
})
export type PushResult = z.infer<typeof pushResultSchema>
